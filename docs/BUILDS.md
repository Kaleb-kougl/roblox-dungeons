# Builds: plan

The boon draft gives one pick per floor from 12 boons that are, all but two, stat bumps (`progressionData.ts`:
+25 % damage, -20 % recovery, +1 heart ...), and a boon can only be owned once. Nothing on screen changes when you pick
one, and two boons never talk to each other. The big moments in this genre come from a build that feels broken. This
plan adds three things that make builds:

1. **On-kill effects.** Three new boons whose effect you SEE: **Chain Spark** (a kill arcs lightning to the next enemy),
   **Volatile** (a kill bursts into a ring of bolts), **Soul Shards** (a kill releases shards that fly at the nearest
   enemies). Kills made by an effect can trigger effects again, so a good room becomes a chain reaction.
2. **Levels and evolutions.** Owned boons come back in the draft as upgrades (level II); the third copy is an
   **evolution** card that turns the boon into a named, stronger version with a new visible rule (Sharpened III ->
   *Executioner*: enemies at 20 % hp die on the next hit).
3. **Duo boons.** Owning two specific boons unlocks a **duo** card (Ember Wake + Piercing Arrows = *Fire Arrows*: arrows
   leave burning embers on the floor).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: everything rule-side lives in the sim, replays, is validated on the server and steps in lockstep.
It follows the established patterns: new boons are appended to `BOONS` (indices are hashed, append only), the build
state is opt-in `SimConfig.builds` (endless worlds only) with its own `state.builds` and its own hash group appended
last, effect bullets reuse the player bullet pool, and the unhashed presentation feeds follow the graze / parry feed's
shape. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial (its floor-2 draft included) replay exactly as
before.

## Status (2026-10-31)

BU0 (the audit) done: findings and the plan changes they force are below. Nothing else built. Read on `main` @
`5a0edc2`. Decisions BUD1-BUD14 are **settled** (2026-10-31, Kaleb: every proposed default accepted; BUD8 and BUD12
stand as technical requirements).

## What the code gives us (read on `main` @ `5a0edc2`)

Paths are under `src/shared/` unless they start with `docs/`.

| Fact | Where | Consequence |
|---|---|---|
| Boons are a port feature (M2, no web source); only endless worlds create `state.run`. The tutorial runs a real draft between floors 1 and 2 (`tutorial/steps.ts` step `draft`) | `sim/progression/progression.ts`, PLAN.md M2 row | No PROVENANCE row. Builds must be opt-in so the tutorial's draft and lock specs do not move |
| `drawBoonOffers` only offers UNOWNED boons; `grantBoon` is a no-op for an owned one; no draft at all once all 12 are owned | `progression.ts` 216-230, 320-336 | Levels need a new offer function and a new grant path; "owned" stops meaning "maxed" |
| `RunPlayerState.boons` / `draftOffers` are lists of boon indices, hashed in the `run` group; `RUN_PLAYER_SCALARS` is append-only | `progression.ts` 479-531 | Keep `boons` as the distinct boons in the order taken (unchanged meaning). Levels, duos and counters live in `state.builds`. A duo card in `draftOffers` needs an id outside the boon range (card ids, below) |
| `RunMods` is derived (`computeRunMods(boons, relics, curses)`), never hashed; every rule reads `runMods(state, i)` or a helper (`playerHitDamage`, `attackTicks`, `rollIframeTicks`, the `team*` reads) | `sim/progression/runMods.ts` | Per-level values slot in by giving `computeRunMods` the levels. No gameplay site changes for the stat side |
| Every multiplier is an integer percent or an exact binary fraction; `combinedPercent(boon, boost)` must stay an integer (Frenzy 70 %, Fury 150 %; a spec checks every combination) | `runMods.ts` 254-290, `drops/dropsData.ts` | Level values are chosen to keep it: Sharpened 125 / 150 / 175 (x 150 = multiples of 1/8), Swift Strikes 80 / 70 / 60 (x 70 = 56 / 49 / 42) |
| A kill by player damage goes `damageActor` -> `killActor` (scoring, Vampire Fang, drops, affixes, `onDeath`). Withers and boss sweeps call `ctx.killActor` directly (`boss/shared.ts` 335 / 450, `summoner.ts` 361) | `sim/combat/actors/actors.ts` 196-241 | The proc hook goes on `damageActor`'s kill line, not in `killActor`: withered summons, boss adds swept at a boss death and reviving turrets (`def.stepDead`, as Fang) never proc |
| The bound player during a hit is the bullet's owner / the swinging player (`ctx.actingPlayer`, `playerBulletOwner(emitter)`) | `sim/combat/ctx.ts` 81-86, `combat.ts` 441-443 | Procs are credited to, and read the build of, the player whose damage made the kill |
| Ember Wake already fires a player burst through `ctx.firePlayer(slot, x, z, dir, spec)` (16 @ FULL_RING, an arc-table shape) | `sim/combat/weapons/weapons.ts` 27-34, 100-102 | Volatile and Soul Shards are the same call. Web arc rows: full rings 3 / 16 / 48, fans 5 @ 0.5, 5 @ 1, 3 @ 0.12, 1 @ 0. New shapes (8 and 12 full rings) are rows in `combat/arcTablePort.ts` |
| Payload: damage 6 / kind 4 / source 8 / pierce 3 / lastHit 7 bits, layout pinned by the fixtures (append only). `kind` uses 0-7 (`GOO` 7), so 8-15 are free; player `source` = weapon index + 1 (4 weapons registered, 2 of them test weapons) | `sim/combat/payload.ts`, `patterns.ts` 24-40 | No layout change: effect bullets take new `BulletKind`s (their look) and a port `source` range (which effect, which generation). Piercing already works (`piercingBulletHit`, 3 bits = up to 7) |
| Player bullet hits go through `playerHitDamage` (Sharpened, Fury) | `combat.ts` 382, 434 | Effect bullets scale with damage boons for free (BUD6 decides whether they should) |
| `BulletSimulation` has `setPayload` but no `setVelocity`; velocity is already part of `writeStateHash` | `sim/combat/bullets.ts` 95-130, 477 | Straight shards need nothing new. True homing (one evolution) needs one `setVelocity(i, x, z)` method; no hash layout change |
| `PLAYER_BULLET_CAPACITY` 512; a full pool drops the shot and counts `c.dropped` | `combat/combatData.ts` 36, `ctx.ts` 214-216 | Effects need a per-tick budget so a cascade can never starve the player's own arrows |
| Arc-shaped bullet erasing exists (`sweepArc`, the guard's, with an `ArcEraseSink` for the parry feed); goo has its own erase rules (EVD14) | `combat/weapons/melee.ts` 114, docs/ENEMY_VARIANTS.md | Evolutions that clear bullets (novas) are a full-circle `sweepArc`, with the guard's goo semantics |
| `stepAffixes` runs inside `stepCombat`, after the actor phase; kills score inside stepCombat; floor clear and room records follow in `stepEndless` / `stepScore` | `sim/step.ts` 186-232 | `stepBuilds` goes inside `stepCombat` after player bullet hits, so effect kills land before the room / floor checks of the same tick |
| The view already tells bullet kinds apart (the goo pool) and has a per-tick unhashed feed pattern (`ScoreEvents` graze / guard fields -> `NearMissEvents` -> one director) | `client/.../BulletRenderController.ts`, `view/fx` | Effect bullets get their own looks by kind; sparks and novas are a `BuildEvents` feed driving one client controller |
| The draft reveal has rarity beats (rare chime, legendary charge / hush / flare / halo) and reads a card's rarity | `view/hud/draftReveal.ts` 49-179, docs/DRAFT_REVEAL.md | Evolution and duo cards reuse the legendary beat (DRD7) with their own colour role; upgrade cards flip like their boon's rarity |
| HUD lists items by `BOONS[index].id` (toasts, items panel), snapshot copies `boons` / `draftOffers` | `view/hud/progression.ts` 136, `play/snapshot.ts` 85, 274, 300 | Every reader of `draftOffers` must decode card ids; the items panel gains level pips |
| `DEFAULT_LOADOUT` = sword + bow (swap) | `sim/combat/weapons/loadout.ts` 8 | Bow-only rules (Piercing Arrows, Fire Arrows) are fine: everyone carries both |

## BU0 findings (2026-10-31)

Read on `builds` @ `125a163` (= `main` @ `5a0edc2` + this plan). Paths under `src/shared/` unless noted.

**Readers of `boons` / `draftOffers` / `BOONS[...]`.**

| Where | Reads | With card ids |
|---|---|---|
| `sim/progression/progression.ts` | `drawBoonOffers` (iterates `b < BOON_COUNT`), `openDraft`, `stepDraft` (`draftOffers[draftSelected]` -> `grantBoon`, `draftChosen = boon + 1`), `writeRunHash` | `drawBoonOffers` iterated BOON_COUNT: appending boons would have changed the tutorial's draft (plan change 1); `stepDraft` branches to `grantCard` |
| `sim/progression/runMods.ts` | `computeRunMods` (`owns(boons, ...)`), `teamOwnsBoon` (Lingering, Composure) | levels through `computeRunMods(p, build?)`; Lingering's team rule reads levels |
| `play/snapshot.ts` | copies `draftOffers` / `boons`, compares them | numbers only: unchanged |
| `play/liveRun.ts` `collectRunEvents` | `draftChosen - 1` as a `"boon"` event's index | the index is a card id: every consumer decodes it |
| `view/hud/progression.ts` | `toastFor("boon")` -> `BOONS[index].id`; `progressionStringKeys` over `BOONS` | `cardDisplay(card)` (a duo card must not index `BOONS`) |
| `client/ui/hud/DraftOverlay.tsx` | `boonOf(b)` = `BOONS[b]` (name, rarity, desc) | `cardDisplay` |
| `client/controllers/fx/DraftRevealController.ts` | `BOONS[offer].rarity`; the pick by `offers.indexOf(event index)`; begins once per floor under `coverLifting` | `cardDisplay`; the re-deal re-begins (plan change 3) |
| `client/ui/hud/RunItems.tsx`, `StatusPanel.tsx`, `TouchStrip.tsx` | owned `boons` -> `BOONS[b]` | `boons` keeps its meaning (distinct boons, order taken): unchanged |
| `client/controllers/ui/HudController.tsx` | `draftOffers.size()` (touch draft taps) | unchanged |
| `tutorial/director.ts` (step `draft`, rule `boon`) | `boons.size() > 0 && draftOpen === 0` | the tutorial has no builds: unchanged |
| `run/testing/endlessBot.ts`, `partyBot.ts`, `tutorialBot.ts` | resolve a draft with one confirm and expect it closed | the double draft keeps it open (plan change 4) |
| `server/` | nothing (runs are validated by replay) | - |

**`damageActor` callers** (all player damage): `combat/weapons/defs/sword.ts` (swing, finisher; the swinging player
bound), `defs/testMelee.ts` (test weapon), `combat/combat.ts` `piercingBulletHit` and `playerBulletHit` (player bullets;
co-op binds the owner in `playerBulletHitParty`). No enemy, hazard or breakable path damages an actor. **Direct
`killActor`**: `archetypes/summoner.ts` `wither` (its summons die with it), `boss/shared.ts` the boss-death sweep of
adds in the arena, and `boss/shared.ts` `debugHit` (KV_Debug's J key, writes hp then kills). Specs call it directly
too. So the proc hook on `damageActor`'s kill line (not in `killActor`) is right: withers, sweeps, revives
(`def.stepDead` turrets, the dummy) and debug kills never proc.

**`BulletRenderController`.** One `BulletPool` per simulation (enemy, player) plus the goo decal pool; a pool takes a
`skip(payload)` predicate (the enemy pool skips `BulletKind.GOO` while the goo pool draws it). The player pool has one
look (`bullet.player.basic`) and switches to the heavy look by scale (`heavyKey`). Effect looks fit either as extra
pools over the same `playerBullets` with complementary kind predicates (each grows to the simulation's high-water mark:
that many more parts per pool), or as a per-part look switch keyed by kind like `heavyKey` (one pool, no extra parts).
The second is cheaper for four kinds; embers are a decal pool exactly like goo. BU8 decides.

**Luau locals.** Counted on `out/` as every column-0 `local` name: `contract.luau` 199, `validate.luau` 200 (the
earlier docs' 198 / 195 counted differently). Both are unchanged after BU1 (no new top-level name in either: the IDs
are written inside existing lists, `buildReport` lives in `buildColors.ts` and is folded into `variantColors.ts`'
`variantColorProblems`, which `validateManifest` already calls), and both compile and load under Lune (the theme specs
run them).

**Not measured.** Run length (floors reached): no evidence in the repo (leaderboard floors live in the DataStore, no
telemetry export), so the picks per run stay the plan's arithmetic; BU13 tunes from play. The player-bullet high-water
on the densest EV13 census rooms: there is no player-bullet census harness (`run/testing/poolHighWater.ts` counts
actors), so it is left to BU3 / BU13, which need that harness anyway for `EFFECT_BULLETS_MAX`.

**Plan changes needed** (to fold into BU1 / BU2):

1. `drawBoonOffers` must keep drawing from the first 12 boons only (`CLASSIC_BOON_COUNT`): it iterated `BOON_COUNT`, so
   appending the on-kill boons would have changed the tutorial's floor-2 draft and every builds-free endless config.
2. The double draft's `remaining` is per player (`BuildPlayerState.draftsLeft`): co-op players confirm at different
   ticks, so one world counter cannot say whose deal comes next.
3. The client must re-begin the draft reveal on a re-deal: `DraftRevealController` begins once per floor under the
   stage cover's fade, and `DraftRevealGate` holds the confirm while a draft is open and its reveal has not begun, so
   the second deal would have soft-locked. It now re-begins when the open draft's `draftTicks` drops.
4. The test drivers (`endlessBot.resolveDraft`, `partyBot.resolveDrafts`) answer every deal of a draft.
5. Every `refreshRunMods` caller passes the build (`grantRelic`, `acceptCurse`, `grantBoon`, the clone), or a relic or
   a curse would silently drop the levels back to level I.
6. `rarityPercents` / `rarityForRoll` move to `progression/rarity.ts` (re-exported) so `builds/cards.ts` can roll
   rarity without a require cycle.
7. Erratum: Chain Spark is in three duos (Storm Blade, Conductor, Chain Reaction), not "one or two".
8. BUD12 leaves almost no warm orange or violet in the placeholder palette (telegraph orange, Fury gold, Aegis
   lavender, goo magenta are all within 40 CIE76): the plan's "orange bolts" and "pale violet shards" cannot be the
   placeholder colours; BU7 picks the vale values (placeholders: cream burst, ice-white shard, peach ember, blue spark).
9. Specs that pinned "affixes is the last hash group" or the classic draft on `buildEndlessRunConfig` floors were
   updated (builds is last; `progression.spec.ts`'s `dungeon()` strips `builds` to keep pinning the classic draft).

## Player experience

1. **Floor 1 draft.** Three cards as today. One might be **Volatile**: "Enemies you kill burst into a ring of bolts."
   Next room, a pack of swarmers pops in a ripple of orange rings; one ring catches a sniper and that burst catches
   another. The player saw their pick work.
2. **Floor 3 draft.** A card shows Volatile again with **II** and two filled pips: "Level II: 12 bolts." Upgrades are
   the reliable way to grow what already works.
3. **Floor 5 draft.** The cards deal; one trembles, the others dim, the eyes on its back light (the legendary beat) and
   it flips gold: **EVOLVE - Volatile III: Cataclysm.** "16 piercing bolts." Picking it plays a flare on the knight and a
   toast. From now on a pack dies in one cascade.
4. **A duo.** The player owns Volatile and picked up Chain Spark on floor 4. On floor 6 a card with both icons joined
   flips with the same beat: **DUO - Chain Reaction.** "Spark kills burst; burst kills spark." Lightning and rings feed
   each other across the room.
5. **After a boss** (floors 5, 10, ...) the draft is a **double draft**: pick one, the cards re-deal, pick again
   (BUD4), and a duo card is guaranteed if one is available.
6. **The pause menu** shows the build: each boon with its level, evolved boons in gold, duos joined.

The rule of thumb for every new rule: if a player cannot see it happen, it is not in this plan.

## Design

### Cards and levels

A draft card is one of four kinds:

| Kind | Offered when | Picking it |
|---|---|---|
| **New** | an unowned boon (today's card) | level I |
| **Upgrade** | an owned common / rare boon at level I | level II (bigger numbers) |
| **Evolution** | an owned common / rare boon at level II | level III: the evolved form (numbers + a new visible rule) |
| **Duo** | both of a duo's boons owned (any level), the duo not yet taken | the duo's rule |

Legendaries (Ember Wake, Composure) stay at level I (BUD1): they are the anchors duos are built on.

**Card ids** (in `draftOffers`, hashed in the `run` group): `0 .. BOON_COUNT - 1` = a boon (New / Upgrade / Evolution
follow from the player's current level, so the id never needs to say which), `DUO_CARD_BASE (64) + duo index` = a duo.
`cardKind(state, player, id)` and `cardBoon` / `cardDuo` decode it; the sim, snapshot and HUD all use them.

**Offers** (`drawCardOffers`, builds runs only; `drawBoonOffers` stays for the tutorial and stays exactly as is):

1. Pools: *new* (unowned boons), *upgrade* (owned common / rare boons below level III; evolutions are in it),
   *duo* (available duos).
2. Per card, in card order, one `rngInt(0, 99)` type roll: below `duoPercent(floor)` and the duo pool not empty and no
   duo in this draft yet -> a duo (one `rngInt` pick); else below `duoPercent + UPGRADE_PERCENT` and the upgrade pool
   not empty -> an upgrade (one `rngInt` pick; evolutions weighted x `EVOLUTION_WEIGHT`); else a new boon by today's
   rarity roll and pick (one roll, one pick). An empty pool falls through to the next kind; nothing left -> fewer cards.
3. **Upgrade pity**: if the player owns an upgradable boon and no card is an upgrade after 3 cards, the last card is
   redrawn from the upgrade pool (one more `rngInt`). Evolutions stay reachable without luck.
4. No duplicate cards in one draft. Maxed boons and taken duos never appear. The draft only closes for good when every
   pool is empty (a full build), as today when all 12 are owned.

Starting numbers (tuned in BU13): `UPGRADE_PERCENT` 35, `EVOLUTION_WEIGHT` 2, `duoPercent` = 20 + 2 per floor cleared,
at most 40.

**Picks per run.** One draft per floor (unchanged) plus a second draft after each boss floor (BUD4): picks before floor
N = N - 1 + bosses. With 15 boons (13 levelable to III, 2 legendaries) and 9 duos there are 50 cards to want (41 boon levels + 9 duos)
and 12 picks before floor 11 (10 floor drafts + 2 boss double drafts), so builds have to commit: a run evolves 2-3 boons and finds 1-3 duos. (Typical run length is not
measured; BU0 records whatever evidence exists, BU13 tunes the percents from it.)

### The three on-kill boons (appended: indices 12, 13, 14)

| | **Chain Spark** (`boon.chainSpark`, rare) | **Volatile** (`boon.volatile`, common) | **Soul Shards** (`boon.soulShards`, rare) |
|---|---|---|---|
| Level I | a kill arcs a spark to the nearest living enemy within 4.5 tiles for 2 damage | a kill bursts into a ring of 8 player bolts (1 damage, speed 10, life 0.35 s) | a kill releases 2 shards aimed at the 2 nearest living enemies within 8 tiles (2 damage, speed 14, life 0.8 s) |
| Level II | the spark jumps on: 2 hops, never the same enemy twice | 12 bolts | 3 shards |
| **III (evolution)** | **Storm Crown**: 4 hops, 3 damage, each hop forks to a second target at half damage (rounded down, min 1) | **Cataclysm**: 16 bolts that pierce 1 | **Soul Swarm**: 4 shards that steer toward the nearest enemy (turn limit per tick) and pierce 1 |
| Look | a jagged beam per hop (0.12 s), spark burst at each target | orange bolts (`BulletKind.BURST`) from the corpse | pale violet shards with a short trail (`BulletKind.SHARD`) |
| Instant / bullet | instant damage in `stepBuilds` | bullets | bullets |

Shards pick their targets at spawn (nearest first, ties by slot order) and fly straight; with fewer targets than shards,
the rest go to the nearest one. Only Soul Swarm steers (BUD11): `setVelocity` each tick toward the nearest living enemy,
`v' = normalize(v + SHARD_TURN * d) * speed` (sqrt only, no trig).

### Chain reactions (the proc engine)

- A kill by player damage pushes a **proc** onto `state.builds.procs`: `{ x, z, owner, gen, slot, id }` (the corpse's
  position, the credited player, the generation, the victim's slot + actor id to skip it).
- `gen` is 0 for a kill by the player's own swing / arrow / Ember Wake / Mirror Cloak bullet, and `gen + 1` for a kill
  by an effect of generation `gen` (sparks carry it in the call, effect bullets in their `source`, below).
- `stepBuilds` drains the queue once per tick, oldest first, at most `PROCS_PER_TICK` (24); the rest wait for the next
  tick (never dropped, except on a floor change). Procs created WHILE draining go to the back and resolve next tick, so
  a cascade ripples outward tick by tick (visible, and never recursive).
- A proc with `gen >= GEN_MAX` (3) does nothing (BUD5). Chain Reaction (a duo) is the only rule allowed to proc from
  its own kind across generations, and it obeys the same cap.
- Each proc fires every on-kill effect its owner has (Chain Spark, Volatile, Soul Shards, the duos and evolutions that
  hook kills), in boon index order.
- **Budget**: effect bullets alive per player are counted by kind; a burst that would exceed `EFFECT_BULLETS_MAX` (160
  of the 512 player slots, per player) fires only what fits (`c.dropped` counts the rest). The player's own weapon fire
  never competes for the last slots.

Effect bullets' `source`: `BUILD_SOURCE_BASE` (128) + effect index x 4 + gen (effects 0-31, gen 0-3; weapon sources
stay 1-127). `playerBulletHit` sets `ctx.procGen` from the source before `damageActor`, the same way it binds the owner.

### Evolutions (level III)

Every common / rare boon gets one. Numbers at levels I / II / III, then the rule only the evolution adds:

| Boon | I / II / III | Evolution: the new visible rule |
|---|---|---|
| Sharpened (rare) | damage 125 / 150 / 175 % | **Executioner**: a hit on a non-boss enemy left at or below 20 % of its max hp kills it (a red "execute" flash) |
| Swift Strikes (common) | recovery 80 / 70 / 60 % | **Flurry**: every finisher releases a 5-bolt crescent (5 @ 0.5, a web shape) along the swing; every 6th arrow fires 3 (3 @ 0.12) |
| Piercing Arrows (common) | +1 / +2 / +2 pierce | **Ricochet**: an arrow that spends its last pierce on a kill splits into 2 arrows aimed at the 2 nearest enemies (gen 1) |
| Hearty (rare) | +1 / +2 / +3 hearts | **Lionheart**: a PERFECT room clear heals half a heart (a heart pulse on the room-clear stamp) |
| Slippery (common) | roll i-frames 150 / 175 / 200 % | **Phantom Step**: enemy bullets you roll through are erased with a spark (no score, no parry feed; goo too) |
| Deep Flask (common) | +1 / +2 / +2 charges | **Overflowing**: drinking releases a nova that erases enemy bullets within 3 tiles (the guard's goo rules) |
| Warding (rare) | +1 / +2 / +2 pips | **Bulwark**: a pip breaking releases a nova that erases enemy bullets within 2.5 tiles |
| Lingering (common) | combo window 9 / 11 / 12 s | **Momentum**: each combo tier crossing (x2-x5) fires Soul Shards equal to the tier (gen 0; works without owning Soul Shards) |
| Daredevil (common) | graze margin 0.75 / 0.875 / 1.0 tiles | **Thrill Seeker**: every 8 grazes release a ring of 8 player bolts around you |
| Bounty (common) | kill points 110 / 120 / 130 % | **Jackpot**: every 15th kill pays a gold pop of 100 x floor points (its own score source) |
| Chain Spark, Volatile, Soul Shards | see above | Storm Crown, Cataclysm, Soul Swarm |

Team-wide boons keep their team rule: Lingering's window takes the highest level any counted player owns (as "any
owner" today); Composure stays a single legendary.

### Duo boons

Each needs both boons owned by the same player (BUD7). Nine in v1:

| Duo | Boons | Rule |
|---|---|---|
| **Fire Arrows** | Ember Wake + Piercing Arrows | every arrow drops an ember on the floor every 6 ticks (a stationary player bolt, 1 damage, 1.2 s life, at most 4 per arrow): the owner's example |
| **Blazing Trail** | Ember Wake + Slippery | a roll leaves an ember every 3 ticks along its path |
| **Storm Blade** | Chain Spark + Swift Strikes | every sword finisher that hits, and every 5th arrow hit, sparks as if it killed (gen 1) |
| **Conductor** | Chain Spark + Piercing Arrows | an arrow passing through an enemy sparks once to the nearest other enemy (1 damage, gen 1) |
| **Shrapnel** | Volatile + Sharpened | burst bolts deal 2 and pierce 1 (Cataclysm's pierce becomes 2) |
| **Chain Reaction** | Volatile + Chain Spark | a spark kill always bursts and a burst kill always sparks, even past gen 1 (still capped at GEN_MAX) |
| **Close Call** | Soul Shards + Daredevil | every 3rd graze releases a shard at the nearest enemy |
| **Gold Rush** | Bounty + Lingering | kills at combo x3 or more score +25 % more (stacks after Bounty, its own pop colour) |
| **Unshaken** | Composure + Warding | a hit taken on armor never cuts the combo |

Embers are player-side goo: stationary player bullets (`BulletKind.EMBER`, speed 0), consumed on the first enemy they
hit, drawn as floor flames under every moving bullet (the goo decal pool's construction). Hearty and Deep Flask have no
duo in v1 (they are the safe picks); every other boon is in one or two.

### Where the build shows

- **Draft cards**: an upgrade card shows its level pips and only the change ("12 bolts, was 8"); an evolution card has
  its own frame (`boon.evolved` role), the evolved name and the legendary beat; a duo card shows both icons joined
  (`boon.duo` role) and the legendary beat. A pick stamp as today.
- **Evolving / taking a duo**: a 1 s flare ring on the knight in the card's colour, `sfx.build.evolve` / `sfx.build.duo`,
  a toast ("Volatile evolved: Cataclysm").
- **In play**: the effects themselves. Effect kills pop score like any kill; a cascade's kill sound climbs with the
  combo as today.
- **Items panel**: level pips under each boon icon, evolved icons gold-framed, duos as a joined chip.
- **Pause / run-over**: a Build list (name, level, one line each).

## Architecture

### 1. Sim data (`sim/progression/progressionData.ts`, new `sim/builds/buildsData.ts`)

- `Boon` += `CHAIN_SPARK: 12`, `VOLATILE: 13`, `SOUL_SHARDS: 14` (append only); `BOONS` rows.
- `BOON_MAX_LEVEL` (legendary 1, else 3); per-level tables (`DAMAGE_BOON_PERCENTS = [125, 150, 175]`, ...). Today's
  single constants stay as the level-I entry so `drawBoonOffers` / the tutorial read the same numbers.
- `DUOS: DuoDef[]` (`{ id, a, b }`, append only), `DUO_CARD_BASE` 64, `BUILD_SOURCE_BASE` 128, `GEN_MAX`,
  `PROCS_PER_TICK`, `EFFECT_BULLETS_MAX`, the effect specs (`BurstSpec`s), the offer percents.
- `BulletKind` += `BURST: 8`, `SHARD: 9`, `EMBER: 10`, `SPARK_BOLT: 11` (Flurry / Thrill Seeker bolts).
- Port arc rows: 8 @ FULL_RING and 12 @ FULL_RING (Volatile I / II, Thrill Seeker), `sim/arcTablePort.spec.ts` cases.

### 2. Sim state (`sim/builds/`, opt-in)

- `SimConfig.builds` (`BUILDS_CONFIG` on endless worlds, `shared/run/endless.ts` next to `affixes`; absent in M1,
  fixtures and the tutorial).
- `state.builds`: per player `levels[BOON_COUNT]`, `duos` (indices, order taken), `grazes` / `kills` / `arrows` /
  `bigHits` counters (Thrill Seeker, Jackpot, Flurry, Storm Blade, Close Call); the `procs` queue. Its own hash group
  **`builds`, appended LAST** (after `affixes`); `hashLayout.ts` names it.
- `computeRunMods(p, build?)`: with a build, the level tables; without, exactly today's values (the tutorial and M1).
- `grantCard(state, i, card)`: New / Upgrade / Evolution raise `levels` (and add to `boons` at level I, so every
  existing reader still works); Hearty / Deep Flask / Warding's one-off effects apply per level gained; a duo goes to
  `duos`. `stepDraft` calls it instead of `grantBoon` when `state.builds` exists.
- The bonus boss draft: `stepRun`'s floor-change branch opens the draft with `remaining = 2` after a boss floor; a
  confirm with `remaining > 1` re-deals (new offers, one more `drawCardOffers`) instead of closing. `remaining` is a new
  hashed field in `state.builds` (not in `RUN_PLAYER_SCALARS`, so the `run` group keeps its layout).

### 3. Sim rules

- `damageActor`: on the kill line, `buildsOnKill(ctx, a)` before `killActor` (needs `a`'s position, the bound player,
  `ctx.procGen`); Executioner's check sits after `filterDamage` / the cap, before the hp subtraction (bosses excluded by
  `def.data.boss`).
- `stepBuilds(ctx)` inside `stepCombat`, after the player bullet hits and `stepAffixes`: drain procs (sparks resolve
  here with `ctx.actingPlayer(owner)`; bursts / shards fire through a `fireEffect(ctx, owner, x, z, dir, spec, effect,
  gen)` helper that writes the source and kind and enforces the budget), Soul Swarm steering, Fire Arrows / Blazing
  Trail embers, counters' releases (Thrill Seeker ring, Close Call shard).
- Hooks: `scoreBulletVisit`'s grazer (Thrill Seeker, Close Call counters), the combo tier crossing (Momentum: read the
  sim's tenths in `stepScore`, fire next tick's shards), the room record's PERFECT (Lionheart), flask drink and armor
  break (Overflowing, Bulwark novas through `sweepArc` with a full circle), the roll (Phantom Step: erase enemy bullets
  overlapping the rolling player while i-frames run), piercing hits (Conductor), finisher / arrow counts (Flurry,
  Storm Blade), kill points (Jackpot, Gold Rush: new score sources appended, as `BREAKABLES` was).
- Floor change: `procs` cleared; effect bullets clear with the floor as all bullets do.
- `BulletSimulation.setVelocity(i, x, z)` (Soul Swarm only).

### 4. Presentation feed (unhashed)

`BuildEvents` (per tick, cleared every tick like `ScoreEvents`): spark segments (`sparkX1/Z1/X2/Z2/Owner/Gen`), novas
(`novaX/Z/Radius/Owner/Kind`), executes (`execX/Z`), evolutions / duos taken (`evolved`, `duoTaken`), Jackpot pops.
`RunView.builds` collects them per tick (`shared/view/fx`, like `NearMissEvents`) for LiveRun and LockstepClient.

### 5. Theme contract

- Strings: the three new boons (`.name` / `.desc` / `.icon`); per level `boon.<id>.desc.2` and the evolution's
  `boon.<id>.evo.name` / `.evo.desc` (13 boons); `duo.<id>.name` / `.desc` / `.icon` (9); `hud.draft.level`,
  `hud.draft.evolve`, `hud.draft.duo`, `hud.draft.again` (the boss double draft), `hud.toast.evolved`, `hud.toast.duo`,
  `hud.build.title` (`BUILD_STRING_KEYS`).
- Colour roles `boon.evolved`, `boon.duo` (with `BOON_RARITY_ROLES` in `boonRarityReport`) and the effect roles
  `build.spark`, `build.burst`, `build.shard`, `build.ember`, validated by a `buildReport`: >= 3:1 on every biome floor,
  **>= 40 CIE76 from every enemy-bullet role, `telegraph`, `enemyGoo`, `enemyOutline` and every boost role** (a player
  effect must never read as danger, and danger never as decoration).
- Bullet visuals `bullet.player.burst` / `.shard` / `.ember` / `.bolt` (placeholders: small neon parts in the role
  colours; ember a flat disc).
- Port audio IDs (SILENT in the placeholder): `sfx.build.spark`, `.burst`, `.shard`, `.ember`, `.nova`, `.execute`,
  `.evolve`, `.duo`, `.jackpot`.
- `contract.luau` / `validate.luau` sit at Luau's 200 top-level locals (198 / 195 after UI art): every new list goes
  inside an existing array or a function, `buildReport` in its own module folded into an existing call; BU1 compiles
  both under Lune first.

### 6. View and client

- `BulletRenderController`: player bullets by kind (burst / shard / bolt looks; embers in a floor decal pool built like
  the goo pool, under markings and every moving bullet).
- `BuildFxController` (one controller, the `NearMissDirector` shape): spark beams (pooled jagged Beams, 0.12 s),
  novas (an expanding floor ring), execute flash, the evolve / duo flare on the knight, the Jackpot pop.
- Audio: the cue mapper gains the build cues with minimum intervals and a voice cap (a cascade must not machine-gun);
  burst / spark pitch climbs with the proc's generation.
- Draft overlay: card kinds (upgrade pips and delta line, evolution / duo frames), the reveal's legendary beat for
  evolution and duo cards (`DraftReveal` takes a "beat" per card instead of reading rarity only), the double draft's
  re-deal and "Pick again" line, `DraftRevealGate` unchanged.
- Items panel and pause / run-over Build list.
- Display setting `buildFx` (Full / Reduced, overrides-only): Reduced halves spark / nova particles and drops burst
  trails. Presentation only; bullets are always drawn.

## Tasks

- **BU0. Audit.** Read-only, findings written into this doc: every reader of `boons` / `draftOffers` / `BOONS[...]`
  (sim, snapshot, HUD, draft reveal, tutorial steps, server); every `damageActor` caller (confirm all are player damage)
  and every direct `ctx.killActor`; the player bullet high-water on the densest EV13 census rooms (headroom for
  `EFFECT_BULLETS_MAX`); `BulletRenderController`'s player pool and how a kind filter fits; the Luau local counts on
  `out/`; any evidence of run length (floors reached) to size the picks. **Verify:** the findings section exists and
  any plan change it forces is listed.
- **BU1. Scaffolding.** `SimConfig.builds`, `state.builds` + clone + hash group, card ids and decoders, the 3 boons
  appended, level tables, `DUOS`, new `BulletKind`s, source range, theme entries with placeholder values, the two port
  arc rows. **Verify:** `npm run verify`; every golden fixture, M1 and the tutorial lock specs match bit for bit; an
  endless run with `builds` absent hashes exactly as before; `contract.luau` / `validate.luau` compile under Lune.
- **BU2. Levels and offers.** `drawCardOffers`, `grantCard`, level values through `computeRunMods`, per-level one-off
  effects, the boss double draft. **Verify:** specs: a maxed boon or taken duo is never offered; the pity rule holds;
  no duplicate cards; level values exact (every Sharpened x Fury and Swift x Frenzy product an integer / exact
  fraction); `drawBoonOffers` unchanged (the tutorial); draft determinism (two runs, same offers); co-op drafts per
  player.
- **BU3. Proc engine.** Kill queue, generations, `ctx.procGen`, `fireEffect` and its budget, `BuildEvents`, floor-change
  clear. **Verify:** specs: withered summons, boss sweeps, reviving turrets and the dummy never proc; gen cap holds; a
  60-kill burst never drops a weapon shot; queue order and carry-over deterministic; co-op credit goes to the owner.
- **BU4. On-kill boons.** Chain Spark, Volatile, Soul Shards at levels I-II. **Verify:** specs per boon (targets,
  hops never repeat, range, damage through `playerHitDamage`, counts per level); a swarmer pack cascade test with the
  expected kill ticks.
- **BU5. Evolutions.** The 13 rules, `setVelocity`. **Verify:** one spec per evolution (Executioner never on a boss and
  only at <= 20 %; Phantom Step only during i-frames; novas use the guard's goo rules and feed no parry; Lionheart only
  on PERFECT; Jackpot every 15th kill; Momentum fires on each tier crossing once).
- **BU6. Duos.** The 9 rules. **Verify:** one spec per duo; a duo with one boon missing is never offered; Fire Arrows'
  ember cap per arrow; Chain Reaction respects GEN_MAX.
- **BU7. Theme and validators.** Strings, roles, `buildReport`, bullet visuals, audio IDs, vale values. **Verify:** the
  validator passes for placeholder and vale and prints every pair `buildReport` checks.
- **BU8. Effect view.** Bullet looks by kind, ember decals, `BuildFxController`, cues. **Verify:** pure view specs
  (feed collection per tick, beam / nova timing, cue rate limits); Studio: effects read as yours next to enemy bullets
  on every biome.
- **BU9. Draft UI.** Card kinds, delta lines, frames, reveal beats, double draft. **Verify:** pure specs
  (`DraftReveal` beats per card kind, the delta text per level); a placeholder draft with every card kind renders.
- **BU10. Build HUD.** Items panel pips / frames / duo chips, pause and run-over Build list, toasts. **Verify:** HUD
  footprint spec still passes (`HUD_FOOTPRINT`); every key exists in the placeholder pack.
- **BU11. Art.** Icons for 3 boons, 13 evolutions, 9 duos (ToffeeCraft UI sheet glyphs or Ninja Adventure icons,
  packed into `ui-icons.png`), effect sprites from Ninja Adventure FX (spark, burst, ember). **Verify:** `npm run
  test:art`; the contact sheet signed off; budget recorded here.
- **BU12. Audio.** The nine port IDs from Ninja Adventure (`art/audio.json`), `audio:build`, `audio:audition`.
  **Verify:** owner audition; silent fallback while ids are missing.
- **BU13. Tuning.** A build TTK table (`variantTtk` harness: plain, each on-kill boon I / III, each duo) on swarmer
  packs, a mixed room and a boss; proc counts per room; player bullet high-water; offer statistics over 1000 simulated
  drafts (how often an evolution / a duo is reachable by floor 6 / 11). **Verify:** the tables here; no census room
  drops a weapon shot; the owner's calls on the numbers.
- **BU14. Studio check and docs.** Frame time on the densest room with Cataclysm + Chain Reaction (desktop and mobile),
  readability next to bullets, CLAUDE.md decision log entry, PLAN.md M2 row. **Verify:** owner sign-off.

## Edge cases

- **Last kill of a room.** The room CLEARs on that kill (stamp, slow motion); its procs still resolve and can only hit
  what is left (nothing, or the next room's enemies if they are in range and alive). Effect kills in a live room count
  for its PERFECT and par like any kill.
- **Effects and room bounds.** Sparks and shards target any living enemy in range, also in a neighbouring room that is
  already live; they never wake a deferred room (unspawned enemies are not actors).
- **Bosses.** Sparks and bolts hit bosses (damage caps apply); Executioner never executes a boss; the Demon Lord's adds
  can proc while the boss lives (they die by damage), not when swept at its death.
- **Slime splits / summons.** Slimelets spawned this tick are skipped by the actor phase but are actors: a burst can hit
  them next tick. Withered summons never proc.
- **Breakables.** Effect bullets break barrels and crates (player bullets do); a broken piece never procs.
- **Co-op.** Builds, levels and duos are per player; procs use the killer's build; each player's effect budget is
  their own. A player who left: their queued procs are dropped. A dead player's in-flight effects keep going.
- **Draft freeze.** The world is frozen during a draft, so the queue waits; the floor change that opens the draft has
  already cleared it.
- **Mirror Cloak.** A reflected bullet is the player's (gen 0). Phantom Step does not reflect.
- **Tutorial / M1 / stage cover.** No builds state: today's draft, today's numbers.

## Decisions (2026-10-31, Kaleb)

Asked: BUD1-BUD7, BUD9-BUD11, BUD13, BUD14 (each answered with the proposed default). BUD8 (endless only) and BUD12
(the colour validator) were not asked: the tutorial lock and bullet readability require them.


- **BUD1. Levels**: common and rare boons go to III, legendaries stay I.
- **BUD2. Evolution is a card**, the third copy, not automatic: the player chooses the moment.
- **BUD3. Duo odds**: 20 % + 2 per floor (max 40) per card, at most one duo per draft; guaranteed in a boss double draft
  when available.
- **BUD4. A double draft after every boss floor** (pick, re-deal, pick).
- **BUD5. Effect kills chain**, up to generation 3.
- **BUD6. Effects scale with Sharpened and Fury** (they are player hits).
- **BUD7. Duos need both boons on the same player** (team duos across players are a later plan).
- **BUD8. Builds are endless only** (`SimConfig.builds`); the tutorial keeps today's draft.
- **BUD9. Leaderboards stay on `LB_Solo_v1` / `LB_Coop_v1`**, as for every earlier endless change.
- **BUD10. Three new boons in v1** (Chain Spark, Volatile, Soul Shards); more on-kill boons later.
- **BUD11. Only Soul Swarm homes**; base shards are aimed at spawn and fly straight.
- **BUD12. Player effects must pass `buildReport`** (never within 40 CIE76 of anything dangerous).
- **BUD13. A `buildFx` Full / Reduced display setting**, presentation only.
- **BUD14. Effect kills score like any kill** (no separate cap or reduced points).

## Risks

- **Power creep.** Cascades can trivialise rooms, and the hp curve (x8.5 by floor 20) was tuned for stat boons.
  Mitigation: GEN_MAX, per-tick proc and bullet budgets, BU13's TTK tables; the levers are the effect damage and the
  duo odds, not the enemies.
- **Clutter.** Player effects on top of bullet hell. Mitigation: `buildReport`, embers flat under every moving bullet,
  short lives, the Reduced setting, BU14's readability pass.
- **Audio spam.** Mitigation: minimum intervals, a voice cap, generation pitch instead of more voices.
- **Frame time.** More bullets and beams on mobile. Mitigation: budgets; BU14 measures the worst build on a device.
- **Pool pressure.** A cascade could starve weapon fire. Mitigation: `EFFECT_BULLETS_MAX` per player below the pool,
  specced in BU3.
- **Endless replays and scores change** from the first draft on (card offers draw differently); fixtures, M1 and the
  tutorial do not move.
- **Luau locals limit** in `contract.luau` / `validate.luau`: BU1 compiles them first.

## Out of scope

- Team duos (one boon from each of two players), relic or curse synergies, boon rerolls or banishes.
- Weapon-specific boon pools or new weapons.
- A meta-progression unlock tree for boons (all boons are available from run 1).
- Changing the 12 existing boons' level-I numbers.
