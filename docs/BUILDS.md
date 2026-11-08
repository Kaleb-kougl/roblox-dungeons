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

**BU0-BU10 code done** (sim, theme, view, UI): the audit (BU0), the scaffolding and offers (BU1 / BU2: opt-in
`SimConfig.builds` on endless worlds, `state.builds` with its own `builds` hash group appended last, the three on-kill
boons appended, level tables, card ids, `drawCardOffers` / `grantCard`, the boss double draft), the proc engine and the
on-kill boons at I-II (BU3 / BU4), the 13 evolutions (BU5) and the 9 duos (BU6), the effect colours (BU7), the effect
view (BU8, its follow-up and the BU6 view below: every `BuildEvents` field is read), the draft UI (BU9) and the build
HUD (BU10). Each step is described in its "as built" section below. Still open: **BU11 art** and **BU12 audio** need
the vendor packs (ToffeeCraft / Ninja Adventure, gitignored `art/vendor/`) on the owner's machine (every build sound
is SILENT and every icon a text label until then); **BU13 tuning** is measured ("BU13 tuning (as built)"; its recommendations are owner calls, nothing changed); **BU14** (Studio
check, frame time, readability) is pending, with the Studio checklists below (items 1-8 of BU9 / BU10, 1-19 of the
effect view). Decisions BUD1-BUD14 are **settled** (2026-10-31, Kaleb: every proposed default accepted; BUD8 and
BUD12 stand as technical requirements).

**Owner calls** collected from the as-built sections (each is built as described; a different answer is a sim change,
so endless replays would change again):

1. **Chain Reaction (BU6).** Read as: below `GEN_MAX` the engine already cross-procs every on-kill boon, so the duo's
   rule is one extra step at exactly `GEN_MAX` (3): a gen-3 spark kill still bursts and a gen-3 bolt kill still sparks,
   both at gen 3, and nothing past it. Confirm, or say what "even past gen 1" should mean.
2. **`effectWeaponReserve` = 32 per player (BU3).** A new rule beside `EFFECT_BULLETS_MAX` (160): effects never use the
   pool's last 32 x party size slots, so a cascade can never starve weapon fire (the specced own-fire peak stays
   within 32). Mirror Cloak's reflections are not covered by it (a full pool drops them, as before).
3. **Executioner (BU5).** "At 20 %" is read as **at or below 20 % after the hit**: a landing hit that leaves a non-boss
   at <= 20 % of its max hp kills it, so an enemy already at <= 20 % dies to any landing hit.
4. **Flurry's triple arrow (BU5, deviation).** Every 6th stream arrow fires as 3 of the bow's own arrows (kind, source
   and pierce of the bow), not effect bullets, so they count as arrows for Fire Arrows / Storm Blade / Conductor and
   not in the effect budget.
5. **Which arrows the arrow duos read (BU6, addition).** Stream, heavy and Flurry arrows (told apart by source and
   speed); the Ember Wake ring fired with the bow in hand and Ricochet's split arrows do not count.
6. **Unshaken (BU6).** A hit on armor keeps the combo but still counts as a hit taken (PERFECT, the boss no-hit bonus).
   **Gold Rush (BU6)**: x125 % after Bounty, kills and boss kills, not the boss no-hit bonus; its points stay in the
   kills / boss sources.
7. **Targets (BU3, addition).** Sparks and shards never pick an actor spawned this tick (a slime's slimelets), and have
   no line-of-sight check (they reach a neighbouring live room, the plan's edge case).
8. **Presentation calls.** The boss double draft's first pick has no stamp (the cards re-deal at once) and its
   guaranteed duo is card 0 of the first deal only (BU2 / BU9); level pips sit inside the item cells (BU10, the status
   panel's footprint is full); effect colours are apricot / violet-white, not the plan's orange / pale violet (BUD12,
   BU7); the Jackpot pop is a big gold score pop, not a floor ring (BU8 follow-up); Gold Rush tints the kill's own pop
   in `boon.duo` instead of adding one (the BU6 view below).

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

**Plan changes needed** (all folded into BU1 / BU2):

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

## BU1 / BU2 (as built)

Where the build differs from, or adds to, the plan:

- **Files.** `sim/builds/` (`buildsData.ts`: duos, card ids and decoders, `cardDisplay`, `BUILD_RULES`, effect
  sources; `effectsData.ts`: effect tunables and BurstSpecs, data only; `builds.ts`: config, state, clone, events,
  `cardKind`, hash; `cards.ts`: `drawCardOffers`, `grantCard`); levels in `progression/progressionData.ts`
  (`*_BY_LEVEL` / `*S` / `*_TOTAL` tables whose first entry is today's constant, `boonMaxLevel`, `levelValue`).
  Theme: `theme/builds.ts` (key lists) and `theme/buildColors.ts` (`BUILD_COLOR_RULES`, `buildReport`).
- **`BuildsConfig` = `BUILD_RULES`** (one frozen object: offer percents, pity, deals per floor, GEN_MAX,
  PROCS_PER_TICK, EFFECT_BULLETS_MAX), like `AFFIXES_CONFIG`. `createSimState` creates `state.builds` whenever
  `config.builds` is set (one empty build per player).
- **State** per player: `levels` (one per Boon index), `duos`, `grazes` / `kills` / `arrows` / `bigHits` (0 until
  BU5 / BU6), `draftsLeft` (plan change 2); world: `procs` (`{ x, z, owner, gen, slot, id }`, empty until BU3). Hash
  group `builds` (`BUILDS_SUBSYSTEM`), names `builds.players[i].levels[b]`, `builds.procs[k].gen`, ...
- **`BuildEvents`** in BU2 carries only the takes (`evolvedPlayer` / `evolvedBoon`, `duoPlayer` / `duoTaken`); the
  effect fields come with BU3+.
- **Offers.** The type roll's fall-through cycles duo -> upgrade -> new -> duo. `duoPercent` = 20 + 2 x the floor just
  cleared (22 % after floor 1), at most 40. Pity replaces the last card of a full draft by a weighted upgrade pick.
  The boss double draft's guaranteed duo is card 0 of the FIRST deal only (one pick, no type roll); the second deal
  rolls normally. A re-deal resets `draftTicks` to 0 (the `DRAFT_MIN_OPEN_TICKS` guard applies again) and sets
  `events.draftOpened`.
- **Grants.** `grantBoon` in a builds run goes through `grantCard` (level I), so `boons` and `levels` never disagree.
  Hearty adds 2 half hearts per level, Deep Flask and Warding 1 / 1 / 0 (totals 1 / 2 / 2).
- **Presentation (minimal; BU9 / BU10 are the real UI).** Card ids decode through `cardDisplay`: a duo card shows its
  `duo.<id>.name` / `.desc` with the legendary rarity look; an upgrade or evolution card still shows the boon's level-I
  name and line. The toast names the card. The reveal re-deals (plan change 3). No "Pick again" line yet.
- **Theme.** Required: 7 strings (`BUILD_STRING_KEYS`, written out in `REQUIRED_STRING_KEYS`), 6 colour roles
  (`boon.evolved`, `boon.duo` on top of the rarity ladder in `BOON_RARITY_COLOR_RULES.roles`; `build.spark` / `.burst`
  / `.shard` / `.ember` in `buildReport`), 4 bullet visuals (`bullet.player.burst` / `.shard` / `.ember` / `.bolt`), 9
  port audio IDs (SILENT). The per-boon and per-duo strings (`boon.<id>.desc.2`, `.evo.name`, `.evo.desc`, `duo.<id>.*`)
  are listed by `view/hud` `progressionStringKeys` (checked by `hud.spec.ts`), as every boon string already was.
  Placeholder colours (BU7 replaces them): evolved `#fff1b8`, duo `#7fe0ff`, spark `#20b0e0`, burst `#fff2d0`, shard
  `#e8f0ff`, ember `#f0d0c0` (each >= 47 CIE76 from every danger role and boost, >= 5.8:1 on every biome floor).
- **Endless replays and scores change** from the first draft (card offers draw differently, and floor 5's draft is
  dealt twice); M1, every fixture and the tutorial replay exactly as before.

## BU3 / BU4 (as built)

Where the build differs from, or adds to, the plan. Paths under `src/shared/sim/`.

- **Files.** `builds/procs.ts` (`buildsOnKill`, `stepBuilds`, `ON_KILL_BOONS`, `hasOnKillEffect`), `builds/effects.ts`
  (`fireEffect`, the budget, `nearestEnemy`, `effectBulletsAlive`), `builds/onKill.ts` (`chainSpark`, `volatileBurst`,
  `soulShards`, `levelEntry`); specs in `builds/procs.spec.ts`. Hooks: `combat/actors/actors.ts` `damageActor` (kill
  line), `combat/combat.ts` (`ctx.procGen` in `playerBulletHit`, phase 6b), `combat/ctx.ts` (`procGen`),
  `endless.ts` `nextFloor` (`clearBuildProcs`), `combat/patterns.ts` (`fireBurstLimited`). Every hook is behind
  `state.builds`; `finishBurst`'s new cut is a no-op at its default limit (`math.huge`), so M1, every fixture, the
  tutorial and endless runs without builds step exactly as before.
- **Procs are queued only when they can do something**: not for a gen >= `genMax` kill (instead of queueing a proc that
  does nothing), and not for an owner with no on-kill boon (`hasOnKillEffect`; BU5 / BU6 widen it for the rules that
  hook kills) or one who left. So a builds run whose players own no on-kill boon hashes exactly as in BU2.
- **Never procs**: reviving archetypes (`def.stepDead`: turrets) and `PROC_INELIGIBLE_ARCHETYPES` (`["dummy"]`,
  `buildsData.ts`), checked in `buildsOnKill` with the archetype `damageActor` already holds; direct `killActor`
  (withers, boss sweeps, debug kills) never reaches it.
- **Generations.** `ctx.procGen` is 0 by default (reset by `bind`, after the player bullet walk and after the drain).
  `playerBulletHit` sets it to `killGenOfSource(source)` (weapon source: 0; effect source: its gen + 1) before any
  damage, solo and co-op alike (the co-op wrapper binds the owner first). A spark sets it to the proc's gen + 1 around
  its `damageActor`. Effect bullets carry the proc's gen in `buildSource(effect, gen)`; gens 0..2 are used.
- **The queue.** `stepBuilds` runs in `stepCombat` right after both collision walks (phase 6b, before contact damage).
  A party first drops leavers' procs (order kept); then `n = min(procsPerTick, queued)` resolve in order, then those
  `n` leave the front (procs their kills pushed stay behind them). Floor change: `clearBuildProcs`.
- **Targets** (`nearestEnemy`): living actors with squared distance <= range^2 (inclusive), ties to the lower slot,
  never the proc's victim (by actor id), never a slot already in the spark / shard list, and **never an actor spawned
  this tick** (`spawnTick === tick`: a slime's slimelets, like the actor phase; addition). No line-of-sight check (the
  plan's edge case: sparks and shards reach a neighbouring live room).
- **Volatile's heading.** Rings fire with `EFFECT_DIR` = +Z (`effectsData.ts`): bolt 0 flies +Z. A shard whose target
  stands exactly on the corpse also uses it.
- **Level tables, level III.** Every number is read by level (`levelValue` / `levelEntry`, clamped): level III reads
  the III entries (4 hops / 3 damage, 16 bolts with pierce 1, 4 shards with `SOUL_SHARD_SPECS[2]` = Soul Swarm's
  piercing shard) but its new rule is BU5's (since built: "BU5 (as built)").
- **Budget** (`fireEffect`): `limit = min(spec.count, effectBulletsMax - owner's live effect bullets, playerCapacity -
  effectWeaponReserve x party size - every live player bullet)`; the first `limit` bullets of the burst's arc order spawn
  (`fireBurstLimited` cuts the arc before the pool: a ring is cut short, never re-spaced, so no new arc row is needed).
  New rule `BuildRules.effectWeaponReserve` = **32** per player: the second bound keeps that many slots per player free
  of effects. The proof: effects only spawn while effects + weapon bullets <= capacity - 32n, and no player ever has
  more than 32 of their own alive (spec: the bow's stream at Swift Strikes III + Frenzy with Ember Wake rings peaks
  above 16 and at most 32), so weapon fire always finds a slot. Mirror Cloak's reflections are the one own-fire source
  not bounded by it (a guard can reflect a wall of bullets); a full pool drops those as today. Counted per owner by
  bullet kind (`EFFECT_BULLET_KINDS` = burst / shard / ember / spark bolt, emitter - 1); `stepBuilds` counts once per
  drain. Refused bullets count in `combat.dropped` and `BuildEvents.effectDropped`. In solo the 160 cap binds; at
  party size 4 the pool bound does (4 x 160 > 512 - 128).
- **Damage.** Sparks: `playerHitDamage(owner, CHAIN_SPARK_DAMAGE[level])` computed once per proc. Bolts and shards: the
  payload damage (1 / 2) goes through `playerHitDamage` in `playerBulletHit` with the owner bound (BUD6).
- **Co-op credit.** Each proc binds `ctx.actingPlayer(owner)`, so scoring's killer (Bounty), Vampire Fang and the
  owner's damage mods are the owner's; effect bullets use the owner's emitter. Player 0 is bound again afterwards.

**`BuildEvents` feed** (per tick, cleared every tick, not hashed; parallel lists, one entry per event, pushed in
resolution order) for the view task:

| Fields | One entry per | Values |
|---|---|---|
| `sparkX1`, `sparkZ1`, `sparkX2`, `sparkZ2`, `sparkOwner`, `sparkGen` | spark hop that hit | from the corpse (first hop) or the previous target's position to the target's position when hit; the owner (party index); the proc's gen (0 = the player's own kill) |
| `burstX`, `burstZ`, `burstOwner`, `burstGen`, `burstFired` | Volatile ring that spawned >= 1 bolt | the corpse, owner, the proc's gen, bolts spawned (fewer than the level's count when the budget cut it) |
| `shardX`, `shardZ`, `shardOwner`, `shardGen`, `shardFired` | Soul Shards volley that spawned >= 1 shard | the corpse, owner, the proc's gen, shards spawned |
| `effectDropped` (number) | tick | effect bullets refused by the budget or a full pool |
| `evolvedPlayer` / `evolvedBoon`, `duoPlayer` / `duoTaken` | take (BU2) | unchanged |

Bursts and shards spawn in phase 6b and first move on the next tick; the bullets themselves are in `playerBullets`
(kind `BURST` / `SHARD`, source `buildSource(effect, gen)`, so `sourceGen` gives the pitch step).

**Specs** (`builds/procs.spec.ts`, 27): the queued proc's fields and same-tick resolution, no proc without an on-kill
boon or without builds, never procs (direct `killActor`, a turret, the training dummy, a real summoner wither, a real
boss-death sweep), generations (sources; spark chain one hop per tick, gen-3 kill queues nothing; a bolt's kill at gen
1), queue order / `procsPerTick` / carry-over, the floor-change clear, leavers, co-op credit (emitter, Vampire Fang
counts), the budget (60 kills at Volatile II with the bow streaming: effects stop at 160, every drop is an effect's, 4
arrows fire; a party of 4 stays under 512 - 4 x 32; the own-fire peak), Chain Spark (nearest / ties / never the victim,
range 4.5 in / 4.51 out, two hops from the last target and never twice, Sharpened I / II damage 2.5 / 3), Volatile (8 /
12 bolts, kind / source / emitter / speed, bolt 0 at +Z, Sharpened 1.25), Soul Shards (2 / 3 nearest, extra shards at
the nearest, sqrt aim, range 8 in / 8.01 out, no target no shard, Sharpened 2.5), a real swarmer pack (8 swarmers,
the bow's stream, Volatile I + Chain Spark I) dying at ticks `[16, 13, 13, 14, 16, 16, 15, 16]` (spawn order; the spec
explains the ripple), and determinism (two runs hash the same every tick).

## BU5 (as built)

The 13 evolution rules, sim only (nothing draws them yet: BU8). Where the build differs from, or adds to, the plan.
Paths under `src/shared/sim/`. Every rule is a no-op without `state.builds` and for a player whose boon is below level
III (`builds/hooks.ts` `isEvolved`); M1, every fixture, the tutorial and endless runs without builds step exactly as
before (the golden, lock and determinism specs pass untouched).

- **Files.** `builds/evolutions.ts` (the rules inside stepCombat: Flurry's crescent, Ricochet, Soul Swarm steering, the
  novas, Thrill Seeker, Momentum, Phantom Step), `builds/execute.ts` (Executioner), `builds/hooks.ts` (a LEAF module for
  the callers that would cycle: score.ts's graze and PERFECT hooks, player.ts's armor break, bow.ts's Flurry arrow
  count; `isEvolved`, `buildPlayerStateAt`, `buildPlayerLeft`), `builds/onKill.ts` (Storm Crown's fork, Soul Swarm's
  source), `builds/procs.ts` (Jackpot, the new stepBuilds order), `builds/effects.ts` (`fireAimedVolley`: Soul Shards,
  Momentum and Ricochet share the aim; `NO_SKIP_ID`), `score/score.ts` (`scoreJackpot`, `addBuildScoreSources`),
  `combat/bullets.ts` (`BulletSimulation.setVelocity(i, x, z)`: x / z velocity of a live bullet, y kept; velocity was
  already hashed, so no layout change). Data in `builds/effectsData.ts` (and `JACKPOT_POINTS` in `score/scoreData.ts`).
  Specs: `builds/evolutions.spec.ts` (30).
- **Generic hooks** (BU6's duos reuse them; each is called only with `state.builds`):

  | Hook | Called from | BU5 rule |
  |---|---|---|
  | `buildsOnKill(ctx, a, def)` (BU3) | `actors.ts` damageActor's kill line | Jackpot counts, then the proc queue |
  | `buildsExecute(ctx, a, def, dmg)` | `actors.ts` damageActor after filterDamage / the Shielded absorb / the cap, before the overkill clamp and hp subtraction | Executioner |
  | `buildsOnGraze(state, grazer)` | `score.ts` scoreBulletVisit, per graze awarded | Thrill Seeker counts (`grazes`) |
  | `buildsOnArmorBreak(state, i)` | `player.ts` damagePlayer, an armor pip broke | Bulwark counts (`bulwarkPending`) |
  | `buildsOnPerfectRoom(state)` | `score.ts` clearRoom, with the PERFECT award | Lionheart |
  | `buildsOnFinisher(ctx, hits)` | `sword.ts` after a finisher's sweep (`hits` = actors hit) | Flurry's crescent |
  | `buildsFlurryArrow(ctx)` / `buildsFlurryArrowsFired(ctx, x, z, n)` | `bow.ts` per stream arrow / after the triple | Flurry's triple |
  | `buildsOnPierceHit(ctx, a, x, z, source, consumed)` | `combat.ts` piercingBulletHit after each actor damaged | Ricochet |
  | `phantomStepOn(state, i)` / `phantomStepErased(state, i, goo, x, z)` | `combat.ts` enemy bullet walks (flags per player computed once per tick) | Phantom Step |

- **stepBuilds** (phase 6b) is now: leavers' procs dropped; `beginEffectBudget`; `stepEvolutions` (a. Ricochet splits
  queued by this tick's player bullet walk, b. Soul Swarm steering, c. novas: Overflowing then Bulwark per player in
  index order, d. Thrill Seeker rings); the proc drain (unchanged); `stepMomentum`; `endEffectBudget`. The effect
  budget's count is now taken lazily at the session's first `fireEffect` (nothing in stepBuilds releases a player
  bullet), so a tick with nothing to fire walks no bullets.
- **The rules** (constants in `builds/effectsData.ts` unless noted):
  - **Storm Crown**: after each hop's strike, the nearest OTHER living enemy within `CHAIN_SPARK_RANGE` of the hop's
    START (same skips, never one already struck) takes `playerHitDamage(owner, max(CHAIN_SPARK_FORK_MIN,
    floor(CHAIN_SPARK_DAMAGE[III] / CHAIN_SPARK_FORK_DIVISOR)))` = 1 (x Sharpened / Fury), procing at gen + 1 like a
    hop; forks never hop on and count as struck.
  - **Cataclysm**: no new code (BU4's `VOLATILE_BURSTS[2]`, pierce `CATACLYSM_PIERCE`); now specced.
  - **Soul Swarm**: III's shards carry a new source, `BuildEffect.SOUL_SWARM` (8, appended), so straight shards (I / II,
    Momentum's) never steer. Each tick (6b) every live SOUL_SWARM shard turns toward the nearest living enemy within
    `SOUL_SWARM_RANGE` (= `SOUL_SHARDS_RANGE`, 8 tiles) of the shard, never the actor it last pierced (payload
    `lastHit`): `v' = |v| x normalize(v / |v| + SOUL_SWARM_TURN x d)` (sqrt only), at most atan(0.25) of turn per tick.
  - **Executioner**: a landing hit (dmg > 0 after the shield and the cap) on a non-boss (`def.data.boss`) that would NOT
    kill it and leaves `(hp - dmg) x 100 <= EXECUTIONER_HP_PERCENT (20) x hpMax` deals the rest instead. Reading:
    "left at or below 20 %" is AFTER the hit, so an enemy already at <= 20 % dies to any landing hit. Credited to the
    bound player (bullet owner, swinger, spark owner); it dies on damageActor's kill line, so it scores, procs and
    counts like any player kill.
  - **Flurry**: a finisher fires `FLURRY_CRESCENT` (5 @ 0.5 `SPARK_BOLT`s, `FLURRY_SPEED` 12, `FLURRY_LIFE` 0.35 s,
    `FLURRY_DAMAGE` 1) from the player along the facing, effect FLURRY, gen 0, in the weapons phase (it moves and hits
    the same tick, like an arrow). Every `FLURRY_ARROW_EVERY` (6)-th STREAM arrow (not the heavy arrow) is fired as
    `FLURRY_ARROW_COUNT` @ `FLURRY_ARROW_SPREAD` (3 @ 0.12): deviation, these are the bow's own arrows (kind PLAYER, its
    source and pierce), not effect bullets; the own-fire reserve spec (Swift Strikes III + Frenzy + Ember Wake, which
    is now Flurry) still peaks within `effectWeaponReserve`. Counter `arrows` (counts only while evolved).
  - **Ricochet**: the hit that ENDS a piercing bow arrow (no pierce left; payload source = the bow's weapon index + 1,
    `RICOCHET_WEAPON_ID`, so heavy arrows and Flurry triples count, effect bolts never) and kills queues a split; 6b
    fires `RICOCHET_ARROWS` (2) `RICOCHET_ARROW`s (`SPARK_BOLT`, speed 16 / damage 1 = the stream arrow's, life 0.5 s)
    from where the arrow ended at the nearest living enemies within `RICOCHET_RANGE` (8 tiles; never the victim; the
    second at the first when only one is found; none found: no split). Effect RICOCHET at the arrow's kill generation
    (0), so the split arrows' kills proc at gen 1 (the plan's "gen 1"). Queued in module scratch from the walk to 6b of
    the same stepCombat call (never across ticks, so not hashed).
  - **Lionheart**: a PERFECT clear heals every living, present Hearty III owner `LIONHEART_HEAL_HALF_HEARTS` (1, up to
    the maximum). The PERFECT judge is score.ts clearRoom's `hitsTaken === hitsAtEngage`.
  - **Phantom Step**: while a player rolls (`rollTicks > 0`) with i-frames running (`iframeTicks > 0`; Ember's
    i-frames alone do not count), an enemy bullet inside their hit circle (the per-kind radius) is erased instead of
    passing through: no hit, no graze, no score, no parry feed; goo too, quietly (no event entry). Co-op: the first
    rolling owner it overlaps, index order.
  - **Overflowing / Bulwark**: novas are `sweepArc` around the player with `NOVA_HALF_ANGLE_COS` (-2: a full circle),
    enemy bullets only, `eraseGoo` (the guard's goo rule), no erase sink (no parry feed), no guard points (they still
    add to `events.bulletsDeleted`, as any sweep does). Overflowing: on the drink tick (`flaskTicks ===
    FLASK_USE_TICKS`), `OVERFLOWING_NOVA_RADIUS` 3 tiles. Bulwark: one per broken pip, `BULWARK_NOVA_RADIUS` 2.5 tiles,
    through the hashed `bulwarkPending` (a break in the actor phase or the bullet walk releases the same tick; contact
    damage steps after 6b, so its nova comes the next tick). A dead or departed owner releases nothing.
  - **Momentum**: after the drain, each tier t in `MOMENTUM_TIER_FIRST`..`MOMENTUM_TIER_LAST` (2..5) whose tenths
    t x `COMBO_DENOMINATOR` the combo crossed upward this tick (`ScoreEvents.comboStart` < t x 10 <= combo: the combo
    only rises inside stepCombat, so no extra state) fires t `SOUL_SHARD`s (straight) from every living Lingering III
    owner at the nearest enemies within `SOUL_SHARDS_RANGE`, effect MOMENTUM, gen 0. Once per crossing; a cut and a rise
    again crosses again.
  - **Thrill Seeker**: grazes count (`grazes`) only while Daredevil III; per `THRILL_SEEKER_GRAZES` (8), 6b of that tick
    fires `THRILL_SEEKER_RING` (8 @ FULL_RING `SPARK_BOLT`s) around the player, effect THRILL_SEEKER, gen 0 (a dead
    owner's ring is dropped).
  - **Jackpot**: every kill a proc could come from (player damage, any generation, never a reviver's or the dummy's)
    counts (`kills`) only while Bounty III; every `JACKPOT_KILLS` (15)-th pays `scoreJackpot`: `JACKPOT_POINTS` (100)
    x the floor into `ScoreSource.JACKPOT`, through the usual multipliers (combo, Depth, curses) like breakables, never
    feeding the combo. It pays before the kill's own scoring (the combo before that kill).
- **Hash.** `builds` group: `bulwarkPending` appended to `BUILD_PLAYER_SCALARS` (6 per player); `grazes` / `kills` /
  `arrows` now move (Thrill Seeker / Jackpot / Flurry). `score` group: `ScoreSource.JACKPOT` = 9 is a BUILD-ONLY source
  (`BUILD_SCORE_SOURCE_NAMES = ["jackpot"]`; `SCORE_SOURCE_NAMES` / `SCORE_SOURCE_COUNT` stay the 9 every scored run
  has): `createSimState` appends its entry to `points` / `counts` only with `SimConfig.builds`
  (`addBuildScoreSources`), dump names `score.points.jackpot` / `score.counts.jackpot`. So every scored run without
  builds (the tutorial, `KV_Scoring` M1, builds-free endless) hashes exactly as before; builds runs' score group is 2
  numbers wider. builds.spec's two BU1 layout pins were updated (6 scalars; the score group's two extra zeros).
- **Fix (BU2 bug).** The bow read Piercing Arrows as "owned or not" (`bowPierce > 0` -> +1), so level II / III fired +1
  instead of +2. `bow.ts` now builds its specs per extra pierce (`*_BY_PIERCE`); without builds `bowPierce` is 0 / 1,
  so nothing else changes.
- **Not done here.** The `score.source.jackpot` string and a results row (the run-over breakdown skips an index without
  a key, so the 10th entry is simply not shown; the view / theme task appends `BUILD_SCORE_SOURCE_NAMES` keys); duo
  rules (BU6); every look and sound (BU7 / BU8).

**`BuildEvents` fields added by BU5** (same conventions as "BU3 / BU4 (as built)": per tick, cleared every tick, not
hashed, parallel lists in resolution order; existing fields unchanged):

| Fields | One entry per | Values |
|---|---|---|
| `sparkFork` | spark segment (parallel to `sparkX1` ... `sparkGen`) | 0 a hop, 1 a Storm Crown fork (from the hop's start to the fork target) |
| `novaX`, `novaZ`, `novaRadius`, `novaOwner`, `novaKind`, `novaErased` | nova | the owner's position, radius in world units (3 / 2.5), owner, `NovaKind` (0 OVERFLOWING, 1 BULWARK), enemy bullets erased (goo included) |
| `execX`, `execZ`, `execOwner` | Executioner kill | the enemy's position, the credited player |
| `phantomX`, `phantomZ`, `phantomOwner` | enemy bullet Phantom Step erased (not goo) | its position, the rolling player |
| `jackpotX`, `jackpotZ`, `jackpotOwner`, `jackpotPoints` | Jackpot pay | the corpse, owner, points paid |
| `lionPlayer`, `lionHealed` | Lionheart heal that restored anything | the player, half hearts restored |
| `momentumX`, `momentumZ`, `momentumOwner`, `momentumTier`, `momentumFired` | Momentum volley (>= 1 shard) | the owner's position, owner, tier crossed (2..5), shards spawned |
| `thrillX`, `thrillZ`, `thrillOwner`, `thrillFired` | Thrill Seeker ring (>= 1 bolt) | the owner's position, owner, bolts spawned |
| `flurryX`, `flurryZ`, `flurryOwner`, `flurryKind`, `flurryFired` | Flurry release | the player's position, owner, `FlurryKind` (0 CRESCENT, 1 ARROWS), bullets spawned |
| `ricochetX`, `ricochetZ`, `ricochetOwner`, `ricochetFired` | Ricochet split (>= 1 arrow) | where the arrow ended, owner, arrows spawned |

The bullets themselves: Flurry crescents, Thrill Seeker rings and Ricochet arrows are `SPARK_BOLT`s, Soul Swarm and
Momentum shards `SHARD`s, told apart by `sourceEffect(source)` (FLURRY 3, THRILL_SEEKER 4, RICOCHET 5, MOMENTUM 6,
SOUL_SWARM 8); Flurry's triple arrows are ordinary arrows.

**Specs** (`builds/evolutions.spec.ts`, 30): Storm Crown (fork target and damage, no fork at II, 4 hops on a line with
forks never re-striking), Cataclysm (16 piercing bolts reach the enemy behind; II's stop), Soul Swarm (source / pierce;
turn-limited steering at constant speed; two runs identical; II straight), Executioner (20 % in / 21 % out, an already
low enemy, it scores and procs, never a boss, never below III), Flurry (a 5-bolt crescent per finisher, none at II;
arrow volleys 1, 1, 1, 1, 1, 3, 1, 1), Ricochet (split at the 2 nearest, both hit; SPARK_BOLTs aimed apart; none at II
or when the last hit does not kill), Lionheart (PERFECT heals, a hit or II does not), Phantom Step (erased with no hit /
score / parry; goo quietly; no i-frames takes the hit; II passes through), novas (Overflowing 3 tiles with goo and no
guard points / parry feed; Bulwark 2.5 tiles; none at II or on a hearts hit), Momentum (tiers 2..5 fire 2..5 shards
once; a drop and rise fires again; II never), Thrill Seeker (one ring per 8 grazes from a real graze; counting only at
III), Jackpot (the 15th kill pays 240 at x2.4; II pays nothing; the source and its dump names exist only in builds
runs), and determinism (every evolution together on a swarmer pack, two runs hash the same every tick).

## BU6 (as built)

The 9 duo rules, sim only (nothing new is drawn: BU8 already draws embers by kind; the feed fields below are for the
view task). Where the build differs from, or adds to, the plan. Paths under `src/shared/sim/`. Every rule is a no-op
without `state.builds` and for a player who does not own the duo (`builds/hooks.ts` `hasDuo`) or who left; M1, every
fixture, the tutorial and endless runs without builds step and score exactly as before (`awardPoints`' new factor is
skipped at its default; the golden, lock, tutorial and determinism specs pass untouched).

- **Files.** `builds/duos.ts` (Fire Arrows, Blazing Trail, Storm Blade, Conductor, Chain Reaction, Close Call;
  `bowArrowLife`, `buildsOnArrowHit`, `stormBladeFinisher`, `chainReactionKill`, `stepDuosBeforeDrain` /
  `stepDuosAfterDrain`), `builds/onKill.ts` (Shrapnel's ring; `volatileBurst` now returns the bolts spawned; sparks set
  `ctx.procCause`), `builds/hooks.ts` (`hasDuo`, `pushDuoProc`, Close Call's graze count, Unshaken in
  `buildsOnArmorBreak`, `buildsGoldRush` / `buildsGoldRushPop` / `buildsUnshakenKept`), `builds/procs.ts` (the genMax
  branch, the new stepBuilds order), `score/score.ts` (Gold Rush, Unshaken), `combat/combat.ts` (the arrow-hit hook,
  `ctx.procCause` for Volatile bolts), `combat/ctx.ts` (`procCause`, unhashed, reset like `procGen`),
  `combat/weapons/defs/sword.ts` (the finisher's first actor hit, passed to `buildsOnFinisher(ctx, hits, first)`).
  Data in `builds/effectsData.ts`; `GOLD_RUSH_*` in `score/scoreData.ts`. Specs: `builds/duos.spec.ts` (19).
- **stepBuilds** (phase 6b) is now: leavers' procs dropped; `beginEffectBudget`; `stepEvolutions`;
  `stepDuosBeforeDrain` (a. Close Call shards, b. Fire Arrows embers, c. Blazing Trail embers); the proc drain;
  `stepDuosAfterDrain` (d. Storm Blade / Conductor sparks in queue order, e. Chain Reaction cross triggers);
  `stepMomentum`; `endEffectBudget`. The sparks run after the drain so their kills proc next tick (one generation per
  tick, as the drain's own sparks). Storm Blade, Conductor and Chain Reaction queue in module scratch from their hook
  to stepBuilds of the same stepCombat call (never across ticks, so not hashed), like Ricochet.
- **Arrows.** A bow arrow is a player bullet of kind `PLAYER` with the bow's source (`DUO_ARROW_WEAPON_ID`) whose
  squared speed is within `ARROW_SPEED_TOLERANCE` (1e-6, relative) of the stream arrow's (16) or the heavy arrow's (22),
  read lazily from the registry (`bow.ts` is never imported, so no registration order moves). Stream arrows, heavy
  arrows and Flurry's triples count; the Ember Wake ring fired with the bow in hand (same source, speed 12) and
  Ricochet's split arrows (effect bolts) do not. Addition: the plan did not say, but without it a roll with the bow in
  hand would have dropped 16 rings' worth of embers.
- **The rules** (constants in `builds/effectsData.ts` unless noted):
  - **Fire Arrows**: each live arrow of an owner drops an `EMBER_BURST` ember (speed 0, damage 1, life 1.2 s =
    72 ticks) where it is when its age is a multiple of `FIRE_ARROWS_EMBER_TICKS` (6), at most `FIRE_ARROWS_EMBERS_MAX`
    (4): ages 6, 12, 18, 24. The per-arrow counter is the bullet's own life: age = round((spawn life - life) x
    `SIM_HZ`), 1 on the tick it was fired; the spawn life (0.75 / 0.7 s) is the one of the arrow kind the speed match
    found. No payload field. Embers in the walk's order (dense slots, backwards), fired after the walk.
  - **Blazing Trail**: a living, rolling owner drops an ember where they stand when the roll's elapsed ticks
    (`ROLL_TICKS` - rollTicks, 0 on the start tick) are a positive multiple of `BLAZING_TRAIL_EMBER_TICKS` (3): elapsed
    3, 6, ..., 18, so 6 per roll; players in index order.
  - **Embers** go through `fireEffect` (effect `EMBER`, gen 0, `EFFECT_DIR`): they count in the owner's effect budget
    and the pool's weapon reserve like every effect bullet. They are ordinary non-piercing player bullets: the first
    enemy that touches one consumes it (payload damage through `playerHitDamage`; a kill procs at gen 1), a wall or an
    intact breakable's cell stops / is damaged by it exactly as any player bullet (none were special-cased: an arrow is
    consumed before it reaches either, and a rolling player never stands in one, so embers practically never touch
    them), and no player bullet ever touches enemy bullets.
  - **Storm Blade**: a finisher that hit (`hits` > 0) queues a spark from the first actor its sweep hit; an owner's arrow
    hits count in `bigHits` (only while the duo is owned) and every `STORM_BLADE_ARROW_HITS` (5)-th queues a spark from
    the enemy hit. The spark is the owner's Chain Spark at their level (hops, damage, Storm Crown's forks) at
    generation 0, the enemy hit as the skipped victim, so its kills proc at gen 1 (the plan's "gen 1").
  - **Conductor**: an owner's arrow that damages an enemy and flies on (piercing, pierce left before the hit) queues one
    hop to the nearest OTHER living enemy within `CONDUCTOR_RANGE` (= `CHAIN_SPARK_RANGE`, 4.5 tiles) of that enemy, for
    `playerHitDamage(owner, CONDUCTOR_DAMAGE)` (1), generation 0 (its kill procs at gen 1). Once per pass-through; the
    hit that consumes the arrow does not spark.
  - **Shrapnel**: Volatile's ring is `SHRAPNEL_BURSTS[level]`: the same 8 / 12 / 16 @ FULL_RING rings with damage
    `SHRAPNEL_DAMAGE` (2) and pierce `SHRAPNEL_PIERCE` (1); Cataclysm's `SHRAPNEL_CATACLYSM_PIERCE` (2). Every Volatile
    ring of the owner, Chain Reaction's included.
  - **Chain Reaction** (interpretation, for the owner to confirm): under BU3's engine every kill below `genMax` already
    procs every on-kill boon the owner has, so "a spark kill bursts and a burst kill sparks, even past gen 1" is already
    true for both boons' owners up to the cap. The duo's rule is the one step the engine refuses: a kill of generation
    exactly `genMax` (3, which queues no proc) still cross-triggers once when it was made by a spark (any Chain Spark
    hop or fork, a Storm Blade or Conductor spark; `ctx.procCause` `SPARK`) or by a Volatile bolt (`BURST`, from its
    payload source): a spark kill bursts (Volatile at the owner's level, Shrapnel included), a bolt kill sparks (Chain
    Spark at the owner's level), both AT generation `genMax` (source gen 3 fits `BUILD_SOURCE_GENS`). What a
    generation-`genMax` effect kills is `genMax + 1` and never procs or crosses, so no effect ever carries a generation
    above `GEN_MAX` and nothing else fires at `genMax` (no same-kind repeat, no Soul Shards). No proc is ever queued at
    `genMax`. Resolved after the drain like the duo sparks.
  - **Close Call**: grazes count in `closeGrazes` (only while the duo is owned; beside Thrill Seeker's `grazes`); per
    `CLOSE_CALL_GRAZES` (3) stepBuilds fires one `CLOSE_CALL_SHARD` (= `SOUL_SHARD`, straight) from the player at the
    nearest living enemy within `CLOSE_CALL_RANGE` (8 tiles), effect `CLOSE_CALL`, gen 0. A dead or departed owner's
    shard is dropped; no enemy in range, no shard (the count is spent).
  - **Gold Rush**: a kill credited to an owner while the combo is >= `GOLD_RUSH_MIN_COMBO` (30 tenths = x3, before the
    kill's own +0.1; `score/scoreData.ts`) scores x `GOLD_RUSH_PERCENT` (125) / 100 after Bounty and the affix bonus,
    as one more integer factor in `awardPoints` (`extraPercent`; exact floor, e.g. test.dummy's 50 at x3 with Bounty I:
    floor(50 x 3 x 1.1 x 1.25) = 206). Kills and boss kills, not the boss no-hit bonus (as Bounty). Points stay in the
    KILLS / BOSS source; no new score source.
  - **Unshaken**: a hit on an owner that breaks an armor pip (`buildsOnArmorBreak`; an Aegis-absorbed hit is not on
    armor) adds 1 to `BuildEvents.unshakenKept`; stepScore cuts the combo `playerHits - unshakenKept` times. The hit
    still counts in `hitsTaken` (PERFECT, the boss no-hit bonus).
- **Hash.** `builds` group: `closeGrazes` appended to `BUILD_PLAYER_SCALARS` (7 per player); `bigHits` now moves
  (Storm Blade). builds.spec's layout pin updated (7 scalars). No other group changed; the score group is unchanged
  (Gold Rush writes into existing sources). Every builds run's hash is one number per player wider.
- **Not done.** No view for the duoProc entries or Gold Rush's own pop colour (the view task reads `duoProcDuo` =
  `GOLD_RUSH` with the points); duo strings already existed (BU1).

**`BuildEvents` fields added by BU6** (same conventions: per tick, cleared every tick, not hashed, parallel lists in
resolution order; existing fields unchanged):

| Fields | One entry per | Values |
|---|---|---|
| `emberX`, `emberZ`, `emberOwner`, `emberDuo` | ember spawned | where (the arrow's position / the rolling player's), the owner, the `Duo` (0 FIRE_ARROWS, 1 BLAZING_TRAIL) |
| `duoProcDuo`, `duoProcOwner`, `duoProcX`, `duoProcZ`, `duoProcValue` | duo rule that fired (embers and Shrapnel have none) | the `Duo`; the owner; where: Storm Blade / Conductor the enemy the spark started from, Chain Reaction the corpse, Close Call / Unshaken the player, Gold Rush the corpse; value: Storm Blade / Conductor / Chain Reaction's spark enemies struck (pushed only when > 0), Chain Reaction's burst and Close Call bullets spawned (only when > 0), Gold Rush the kill's points (its `popPoints` entry), Unshaken 1 |
| `unshakenKept` (number) | tick | hits taken on armor by Unshaken owners. The one BuildEvents field the sim reads (stepScore, same tick) |

Duo sparks also push ordinary spark segments (`sparkX1` ... `sparkGen` 0, `sparkFork` 0; Storm Crown forks of a Storm
Blade spark `sparkFork` 1) and Chain Reaction's cross bursts / sparks the ordinary burst / spark entries at gen 3.

**Specs** (`builds/duos.spec.ts`, 19): offers (for every duo, one boon owned never offers it over 40 seeds with a
guaranteed duo; both owned always; taken never), Fire Arrows (embers on steps 5 / 11 / 17 / 23 of a 45-tick arrow, 1.6
apart; stationary EMBER, source, damage 1, in `effectBulletsAlive`, each gone 72 steps later; consumed by the first
enemy only; a heavy arrow 4; the bow's Ember Wake ring none; no duo none), Blazing Trail (6 embers at elapsed 3 .. 18 at
the player), Storm Blade (one spark per finisher, none for swings; every 5th arrow hit, `bigHits` the rest; the spark's
kill bursts at gen 1), Conductor (the passed enemy's neighbour takes 1, the consuming hit sparks nothing), Shrapnel (8
bolts 2 / pierce 1; Cataclysm pierce 2; without 1 / 0), Chain Reaction (genMax spark kill bursts at gen 3 only, bolt
kill sparks at gen 3 only; gen 4 kills, NONE causes and no duo do nothing; a 4-enemy spark line bursts at gens 0-3 with
the duo and 0-2 without, no proc ever queued at genMax), Close Call (3rd graze, a real graze beside Thrill Seeker's
count, no duo no count), Gold Rush (exact points at x3 / x4.5 / Bounty III, none at x2.9 or without), Unshaken (armor
hit keeps x3.0, hearts hit and no duo cut to 22), determinism (all 9 duos on a swarmer pack with the bow and rolls, two
runs hash the same every tick).

## BU9 / BU10 (as built)

Presentation only: no sim, hash, replay or fixture change. Paths under `src/` unless noted.

- **Files.** Pure: `shared/view/hud/draftCards.ts` (BU9: `HudText` = key + literal vars + `varKeys` looked up as
  theme keys; `draftCardModel(card, kind)`, `draftBeatFor`, `draftToneRole` / `rarityTone`, `draftCardKinds`,
  `draftRedealt`, `boonLineKey` / `boonLevelNameKey` / `levelText`, `DRAFT_CARD_VIEW`, `DUO_CHIP_SPAN`) and
  `shared/view/hud/buildHud.ts` (BU10: `runItemCells`, `capItemCells`, `itemPipLayout`, `buildListRows`,
  `capBuildList`, `pauseBuildWidth`, `BUILD_HUD_VIEW`), specs `draftCards.spec.ts` / `buildHud.spec.ts`.
  `draftReveal.ts`: `DraftBeat` (values = `Rarity`'s), `begin(beats)`, frame `cards[i].beat` (was `rarity`);
  `draftRevealView.ts` reads beats. Client: `DraftRevealController` (kinds read once at the deal), `draftUi.ts`
  (`model`, `beat`, `tone` per card, `again`), `DraftOverlay` (`BannerRow`, "was" line, "Pick again"), `DraftRays`
  (binding colour), `RunItems` (rewritten on the cell model), new `BuildList.tsx` (`BuildList`, `PauseBuild`),
  `PauseOverlay`, `RunOverPanel`, `ToastPanel`, `client/ui/theme` `hudText`. Snapshot: `boonLevels` (parallel to
  `boons`) and `duos`, the local player's (`playerIndex`), empty without builds. `RunEventRecord.build`
  (`"evolved"` / `"duo"`, from the BU2 `BuildEvents` of the same tick, `buildTakeOf`); `toastFor(kind, index, build)`;
  `ToastSpec` / `ToastView` gained `varKeys`.
- **Card kinds.** Read with `cardKind` for the LOCAL player when the deal is dealt (before the pick raises the level),
  so the overlay keeps the right faces through the pick's stamp and exit fade. New: today's card. Upgrade: name, banner
  "Level II" + 2 of 3 pips in the card's colour, the line `boon.<id>.desc.2`, and under it `hud.draft.was` with the
  level below's line ("was: Enemies you kill burst into a ring of 8 bolts"); it flips like its boon's rarity. Evolution:
  the `.evo.name` / `.evo.desc`, banner "EVOLVE · {boon}" in `boon.evolved`, 3 of 3 pips, the legendary beat
  (charge, skulls, halo; rays and glow in `boon.evolved`). Duo: name / desc, a joined chip of its two boons' icon
  labels (each in its boon's rarity colour) + "DUO" in `boon.duo`, the legendary beat in `boon.duo`. Without builds
  (the tutorial) every card is New: today's draft. The face art stays the studded (rare) face for every legendary beat
  (no tint); the "own frame" is the glow / flat stroke in the card's colour, always on after the flare (halo pulse).
- **Double draft.** The re-deal (the previous agent's re-begin on a `draftTicks` drop) is kept; `draftRedealt` (draft
  open, `0 < draftsLeft < deals of the floor just cleared`) sets `DRAFT_UI.again` at the begin: "Pick again"
  (`hud.draft.again`, uiAccent) shows under the title on the SECOND deal only (not on the first). The first pick of a
  double draft still has no stamp (the cards re-deal at once), as before.
- **Items row.** Boons (order taken), then duos (order taken, a double-wide joined chip in `boon.duo` with both boons'
  icon labels), then relics, curses. Deviation: the level pips sit INSIDE the bottom of each boon cell (label moved up),
  not under it: the status panel's 160 px footprint is full (`HUD_FOOTPRINT`, footprint.spec unchanged and passing).
  Evolved boons: a 2 px `boon.evolved` outline. Legendaries and builds-free runs: no pips. The row is now a horizontal
  list sized by `capItemCells` (one row, "+N" first, spans aware) instead of `GridRow` / `capOneRow`; touch chips use the
  same component (smaller cells, `itemPipLayout` scales the pips).
- **Build list.** "Build" (`hud.build.title`) then one row per boon (name or evolution name in its colour, level "I".."III"
  or "" for a legendary / no builds, the line it has now, truncated) and per duo. Pause / party overlay: a side panel
  right of the menu (`PauseBuild`; the solo map is on the left), width `pauseBuildWidth` (300, down to 260 on a narrow
  screen), 12 rows (8 on touch), "+N" after. Run-over: beside the score breakdown (a Row) in the full layout; a third
  260-wide column (8 rows) in the compact (phone) layout.
- **Toasts.** A pick the sim recorded as an evolution shows `hud.toast.evolved` ("Volatile evolved: Cataclysm"), a duo
  `hud.toast.duo` ("Duo: Fire Arrows"), anything else `hud.toast.boon` as before. No flare or sound yet (BU8 / BU12).
- **Theme.** Only one key added: `hud.draft.was` ("was: {desc}", not required by the contract, in
  `progressionStringKeys`, checked by hud.spec like `hud.items.more`). Changed placeholder values: `hud.draft.evolve`
  "EVOLVE" -> "EVOLVE · {boon}"; `boon.volatile.desc` / `boon.soulShards.desc` now name their level-I counts (8 bolts,
  2 shards) so the "was" line reads as a delta. No contract, colour role or Luau-locals change.
- **Not done.** No pick stamp on the first card of a double draft; `KV_DraftRevealDebug` still takes beats only
  (c / r / l), not card kinds; no art for the chip icons (text labels until BU11).

**Studio checklist (nothing could run in Studio here).**

1. Endless solo with builds: floor 1 draft shows three New cards exactly as before (names, rarity row, reveal).
2. Own a common / rare boon at I: its Upgrade card reads "Level II" + 2 of 3 pips, the level II line, "was: ..." dim
   under it, no overflow on the flat card and on the ToffeeCraft faces (name / banner nudge on the rare face).
3. Own it at II: the Evolution card flips last with the charge / hush / flare, glow and rays in `boon.evolved` gold,
   "EVOLVE · <boon>", 3 pips; picking it toasts "<boon> evolved: <evo>".
4. Own both boons of a duo: the Duo card's chip (two icon cells) + "DUO" fits the banner row with the skulls; legendary
   beat in `boon.duo`; picking it toasts "Duo: <name>".
5. Clear floor 5 (boss): first deal (guaranteed duo) has no "Pick again"; after the pick the cards re-deal and "Pick
   again" shows under the title; the confirm is not held forever (reveal re-begins). Co-op: each player's own.
6. Items panel: pips inside each boon cell readable at 100 % / 70 % HUD scale and on the touch chips; an evolved boon
   has the gold frame; a duo chip is double width; with many items the "+N" cell appears and the panel stays in its
   footprint.
7. Pause (solo and co-op party overlay): the Build panel sits right of the menu, clear of the screen edge at 1280 x 720,
   1024 x 768 and a phone; run-over panel full and compact (phone) layouts with the Build column.
8. Tutorial floor 2 draft and M1: unchanged (no pips, no Build rows beyond the tutorial boon's plain row in pause).

## BU7 / BU8 (as built)

Presentation only: no sim, hash, replay, fixture or lockstep change. Paths under `src/` unless noted.

**BU7 (theme).** Final effect colours in the placeholder pack (vale clones them; the plan's "orange bolts" / "pale
violet shards" cannot pass BUD12 in this palette, so they are the nearest light, warm shades that do). Measured by
`buildReport` (theme/builds.spec.ts prints all 168 pairs: 3 packs x 4 roles x (5 floors + 9 danger / boost roles)):

| Role | Value | Nearest danger / boost (CIE76) | Lowest floor contrast |
|---|---|---|---|
| `build.spark` | `#88d4fc` sky blue | 44.4 (quickstep, aegis) | 8.97:1 (biome.3) |
| `build.burst` | `#f8c8a0` apricot | 44.7 (telegraph); Fury 46.0 | 9.59:1 (biome.3) |
| `build.shard` | `#f4e8f8` violet-white | 44.8 (aegis) | 12.37:1 (biome.3) |
| `build.ember` | `#f4f4b0` lemon cream | 44.5 (Fury) | 12.84:1 (biome.3) |

The four are >= 25 CIE76 from each other (burst / ember the closest; they differ in shape: bolt vs floor disc). Strings
and audio IDs were already complete (BU1: 7 `BUILD_STRING_KEYS`, per-boon / per-duo strings via
`progressionStringKeys`, 9 SILENT `sfx.build.*` in `PORT_AUDIO_EVENTS`); BU8 adds three non-contract strings
`options.display.buildFx` / `.full` / `.reduced` (checked by hud.spec through `optionsStringKeys`). No contract,
validator or Luau-locals change.

**BU8 (effect view).**

- **Feed.** `shared/view/fx/buildFxEvents.ts` `BuildFxEvents` (`RunView.builds`, reset per frame, collected per tick in
  LiveRun and LockstepClient, like `NearMissEvents`): sparks, bursts, shards, takes (evolved / duo) with their tick.
  Additions: **embers** have no feed entry, so a player-bullet slot of `BulletKind.EMBER` whose life went UP since the
  last tick is a new ember (per-slot memory across frames; owner = emitter - 1, gen from the source). **Novas /
  executes** are read through `PendingBuildEventFields` with the plan's names (`novaX/Z/Radius/Owner/Kind`,
  `execX/Z`) when BU5 adds them; until then nothing. **Jackpot**: no documented field, the `jackpots` list stays empty.
  `audibleBuilds(source, comboQuiet(...))` is the audio gate.
- **Director.** `buildFxRules.ts` `BuildFxDirector` (one per client, owned by `client/controllers/fx/BuildFxController`,
  stepped as an FxTracker frame handler like `NearMissController`; `onFrame` subscribers). Beams live `BEAM_SEC` =
  the sim's `SPARK_BEAM_TICKS` x `SIM_DT` (7 ticks, 0.117 s), opaque 40 %, then fade; 5 jagged segments re-rolled every
  0.04 s (never under reduced motion), at most 24 alive. A spark burst (particle chips in `build.spark`) at each new
  hop's target, at most 8 per frame (view player first), none with particles off. Novas: an expanding floor ring
  (0.35 s, 24 segments). Execute: a flat disc in `uiHealth` popping out over 0.08 s, 0.22 s (the plan's "red" flash).
  Evolve / duo flare: a 1 s ring around the taking player (0.3 -> 1.4 tiles) in `boon.evolved` / `boon.duo`. Quiet
  (stage cover, run over) and a new run forget everything. Tunables `BUILD_FX_VIEW` (`buildFxConfig.ts`).
- **Bullets.** `shared/view/buildBullets.ts`: `playerBulletLookOf(payload, scale)` (BURST / SHARD / SPARK_BOLT ->
  burst / shard / bolt; anything else the weapon bolt, heavy by scale as before). `BulletRenderController`'s `BulletPool`
  now takes a look array + `lookOf` (one pool, a per-part look switch replacing `heavyKey`: no extra parts per kind).
  Burst and shard bolts trail one faint part per slot (`BUILD_BULLET_VIEW.trail`, a Map by slot) while
  `buildTrailsOn` (Full and not reduced motion). Embers: the goo pool generalised to `DecalPool` (`GOO_DECAL`,
  `EMBER_DECAL`); embers lie at lift 0.045 (under the goo's 0.08, every marking and every moving bullet), 0.5 tiles,
  pop 0.08 s / fade 0.3 s; the player pool skips them.
- **Audio.** `cues.ts`: nine `SFX.build*` (ALL_SFX, PORT_SFX, intervals 0.06-0.5 s, ranks: evolve / duo 64, jackpot
  61, execute 56, nova 52, spark 51, burst 48, shard 47, ember 44). `AudioCueMapper.frame(..., builds)`: one cue per
  effect per frame at `buildGenSpeed(highest gen)` (+2 semitones per generation, max +6), volume 0.6, a teammate-only
  effect at teammate volume / rank - 50; **voice cap** 4 build starts per 0.25 s (`BUILD_VOICE_SFX` order, counted
  from cues that actually started); evolve / duo through `playerCue`, outside the cap. All silent today (placeholder).
- **Setting.** `DisplaySettings.buildFx` (`"full"` default, only `"reduced"` stored, doc stays v2; `BUILD_FX_LEVELS`);
  Options > Display row after Player outline. Reduced halves spark-burst counts and ring segments
  (`buildFxCount`, `reducedShare` 0.5) and drops trails; reduced motion also drops trails, the beam crackle, the ring
  growth (drawn at full radius, fading) and the execute pop.
- **Deviations.** Beams are pooled Neon Part segments, not Roblox `Beam`s (no attachments; one BulkMoveTo). The plan's
  colour words (orange / pale violet) became apricot / violet-white (BUD12). The ember cue plays on an ember's
  appearance (no feed field). The execute flash uses `uiHealth` (no new role).
- **TODO for BU5 / BU6 (sim).** Novas and executes switch on by themselves once `BuildEvents` carries `novaX/Z/Radius/
  Owner/Kind` and `execX/Z` (delete `PendingBuildEventFields` then; give `BUILD_FX_VIEW.nova.looks` a role per nova
  kind). Jackpot: name the feed fields (proposed `jackpotX/Z/Owner/Points`), collect them into `jackpots` and draw the
  pop in `BuildFxController` (the director already ages it; the cue already plays `sfx.build.jackpot`).
- **Specs.** `view/fx/buildFxEvents.spec.ts` (collection per tick, reset, no builds, embers once, BU5 fields, quiet
  gate, LiveRun with a real Chain Spark + Volatile proc, LockstepClient per pump), `view/fx/buildFxRules.spec.ts`
  (beam timing / jag / cap, bursts, Reduced, trails rule, rings, flares, flashes, quiet / new run, generation pitch),
  `view/buildBullets.spec.ts` (kind -> look, trails, pool split, ember decal), `view/audio/buildCues.spec.ts` (IDs,
  pitch, teammates, intervals, voice cap, stings, silent IDs, quiet), `settings.spec.ts` (default, storage, junk).

**Studio checklist (nothing could run in Studio here).**

1. Endless solo, Volatile I: a kill bursts 8 apricot bolts with short trails, clearly not the pink enemy balls or the
   orange telegraph on every biome; Options > Display > Build effects Reduced: no trails.
2. Chain Spark II: a jagged sky-blue beam per hop for ~0.12 s with a small spark burst at each target; Reduced: fewer
   particles; reduced motion: the beam holds one shape.
3. Soul Shards: violet-white shards with trails toward the nearest enemies.
4. A cascade on a swarmer pack: the spark / burst sounds climb in pitch with the generation and never machine-gun
   (once clips exist; silent today).
5. Pick an evolution / a duo: a gold / ice-blue ring grows around the knight for 1 s (and follows it).
6. Fire Arrows (after BU6): lemon floor discs under the goo and under every bullet; pop in, fade out.
7. Frame time with a dense cascade (beam / ring / trail parts pooled: `BuildFxController.getPoolSizes`,
   `BulletRenderController.getBuildPoolSizes`).
8. The stage cover and the run-over panel: no beams, rings or build sounds.

## BU8 follow-up (as built)

Presentation only: no sim, hash, replay, fixture or lockstep change. Closes BU8's "TODO for BU5 / BU6 (sim)" for BU5's
fields. Paths under `src/` unless noted.

- **Feed.** `shared/view/fx/buildFxEvents.ts`: the `PendingBuildEventFields` shim is gone; every BU5 field is read
  typed, per tick, into its own pooled list on `BuildFxFrameSource`: `SparkRecord.fork` (`sparkFork`; hand-filled specs
  without it read as hops), `novas` (`NovaRecord`: amount = radius, kind = `NovaKind`, `erased`), `executes` (now an
  `EffectRecord` with the credited owner; `ExecuteRecord` removed), `phantoms`, `jackpots` (amount = points), `heals`
  (owner = the healed player, x / z where they stood at collect, amount = half hearts), `momentum` (kind = tier, amount =
  shards), `thrills`, `flurries` (kind = `FlurryKind`), `ricochets`. BU5 records carry gen 0. `count` / `reset` walk
  one list of the effect pools.
- **Director** (`buildFxRules.ts`, tunables in `buildFxConfig.ts`). `RingView.flare` became `look`
  (`BuildRingLook` = `nova` / `flare` / `heal` / `pop`; `buildRingBlock(look)` gives the drawing block). Rings live in
  three internal lists (novas capped at `nova.maxAlive`, origin flares at `pop.maxAlive`, followers one per player and
  look) so a busy cascade never evicts the knight's flare; `rings` is rebuilt from them each frame.
  - Novas: `nova.looks` = Overflowing `fx.heal` (the flask effect's green: it fires on the drink), Bulwark
    `build.spark`; `novaRole(kind)`, unknown kinds the fallback. Expanding 0 -> radius over 0.35 s as before.
  - Origin flares (`pop`): a 0.25 s ring 0.1 -> 0.55 tiles at a Momentum volley (+0.1 tile per tier above x2,
    `momentumPopTiles`), Thrill Seeker ring, Flurry release and Ricochet split; Momentum in `build.shard`, the other
    three in `build.spark` (the colour of what they fire). Stays where it left.
  - Lionheart: a 0.6 s pulse 0.5 -> 1.2 tiles in `fx.heal` around the healed player, following them (like the flare;
    a newer one replaces it; ends on death).
  - Phantom Step: chip bursts (`phantomBursts`, `phantomShape`: 2 bits + 3 sparks, `build.shard`), at most 8 a frame,
    view player first, none with particles off; `ParticleController.buildPhantomBurst` (one palette entry appended).
  - Executes: flashes only for owners in the party; otherwise unchanged (`uiHealth` disc, pop).
  - Storm Crown forks: `BeamView.fork`; `BuildFxController` draws them at `beam.forkThicknessShare` (0.6) thickness.
  - The evolve / duo flare is BU8's, unchanged (now a `flare` follower).
  - Reduced halves every ring's segments and both chip shapes (`buildFxCount`); reduced motion draws every ring at its
    end radius (fading only), no execute pop, no beam crackle, no trails (as BU8).
  - The director's Jackpot slot (`JackpotView`, `jackpots`) is removed: see Score.
- **Score.** The Jackpot pop uses the score pops' machinery: `ScorePopController` keeps a second `ScorePopPool`
  (`BUILD_FX_VIEW.jackpot.maxAlive` 4) fed from `RunView.builds.jackpots`, same "+points" string, life, fade, rise and
  `damageNumbers` gate, glyphs x2, 6 px higher, in `boon.legendary`'s candle gold (a HUD text colour; a gold floor ring
  was rejected: it would read as a Fury drop's halo at the same corpse). `score.source.jackpot` ("Jackpot") added to the
  placeholder pack (vale inherits it; not a contract key). `SCORE_SOURCE_KEYS` = `SCORE_SOURCE_NAMES` then
  `BUILD_SCORE_SOURCE_NAMES` (10 keys); the run-over breakdown takes its rows from the new pure
  `scoreBreakdownRows(points)` (shared/view/hud strings.ts), so a builds run (10 points) shows the Jackpot row and
  every other scored run (9) is unchanged.
- **Audio** (`cues.ts`). `buildCue(id, localIndex, a, b?, c?)` merges up to three lists (highest gen, "mine" if any
  record is the local player's): `.burst` = Volatile rings + Thrill Seeker + Flurry, `.shard` = Soul Shards + Momentum
  + Ricochet; `.nova`, `.execute` (now owner-aware: a teammate's alone is quieter) and `.jackpot` from their feeds. Same
  intervals, ranks, voice cap and quiet gate. Phantom Step and Lionheart have no cue (the roll and the PERFECT sting
  already sound; a dense erase must not stutter).
- **No new colour role**, so no validator or Luau-locals change: every ring and chip reuses a role already validated
  (`fx.heal` by the fx rules, `build.*` by `buildReport`, `boon.legendary` by the rarity report; the pop is text).
- **Specs.** `view/fx/buildFxEvents.spec.ts` (every BU5 field into its list with amount / kind, two ticks, reset; the
  sim's own pushes: 15 Executioner kills and a Jackpot through `damageActor` in a real endless run),
  `view/fx/buildFxRules.spec.ts` (nova roles and timing, fork flag, origin flares by tier / role / cap that never evict
  the flare, the Lionheart pulse following and ending, reduced motion, Phantom sparks cap / order / particles off /
  Reduced, quiet over every ring kind), `view/audio/buildCues.spec.ts` (nova / execute / jackpot cues, the burst / shard
  reuse with merged generation, teammate volume, Phantom / Lionheart silent, interval and voice cap across the
  releases), `view/hud/hud.spec.ts` (10 keys, the Jackpot string, `scoreBreakdownRows` 9 vs 10 rows).
- **Not done.** No duo (BU6) look beyond BU8's embers; no art or clips (all build sounds are SILENT in the placeholder);
  `novaErased` and `lionHealed` are collected but not shown (no count on screen).

**Studio checklist, continued (nothing could run in Studio here).**

9. Deep Flask III: drinking a flask grows a green ring to 3 tiles that wipes nearby bullets; Warding III: an armor pip
   breaking grows a blue 2.5-tile ring. Both under the bullets, readable on every biome.
10. Sharpened III: a red disc pops on each executed enemy; never on a boss.
11. Slippery III: rolling through bullets leaves small violet-white chips where they vanish; Reduced: fewer chips;
    particles off: none.
12. Bounty III: every 15th kill pops a big gold "+points" above the corpse (bigger and higher than kill pops; off with
    damage numbers); the run-over breakdown has a "Jackpot" row in builds runs only (none in the tutorial / M1).
13. Hearty III: a PERFECT clear rings the knight in green for 0.6 s (following it).
14. Lingering III / Daredevil III / Swift Strikes III / Piercing Arrows III: a small flare at the knight (or where the
    arrow split) on each Momentum volley (bigger per tier), Thrill Seeker ring, Flurry release and Ricochet split.
15. Chain Spark III: Storm Crown forks are visibly thinner than the hop beams.
16. Pick an evolution while a cascade is running: the gold flare still shows (not evicted by flares / novas).

## BU6 view (as built)

Presentation only: no sim, hash, replay, fixture or lockstep change. Closes BU6's "Not done" (no view for the duo
procs, Gold Rush's own pop colour). Paths under `src/` unless noted.

- **Feed** (`shared/view/fx/buildFxEvents.ts`). Embers now come from the sim's ember feed (`emberX/Z/Owner/Duo`; kind =
  the `Duo`, gen 0): BU8's inference from new `BulletKind.EMBER` slots and its per-slot memory are gone (every ember
  the sim fires is a duo's and pushes one entry; `isEmberPayload` stays for the bullet renderer's decal pool). The
  `duoProc*` entries are split by duo into `goldRush` (amount = the kill's points), `unshaken` (owner = the player hit,
  x / z where they stood) and `duoProcs` (Storm Blade, Conductor, Chain Reaction, Close Call; kind = the `Duo`, amount =
  the value). `unshakenKept` (a per-tick count) is not read: the Unshaken entries carry the player.
- **No double draw.** Storm Blade / Conductor sparks and Chain Reaction's cross sparks / bursts already arrive as
  ordinary spark segments and burst entries (BU6), so their beams, spark bursts and cues are BU8's; Close Call's shard
  and every ember are ordinary effect bullets. The duo view only adds what those lack:
  - **Origin flare**: each `duoProcs` record pops BU8 follow-up's origin ring (`pop` look, same size, life and cap) in
    `BUILD_FX_VIEW.pop.duoRole` = `boon.duo`, at the enemy the spark left from / the corpse / the player.
  - **Unshaken glint**: a new following ring look `glint` (`BUILD_FX_VIEW.glint`: 0.4 s, closing in 1.1 -> 0.7 tiles,
    16 segments, `boon.duo`) on the hit player, one per player (a newer hit restarts it), beside the evolve flare and
    the Lionheart pulse; drawn by `BuildFxController` through `buildRingBlock` like every ring.
  - **Gold Rush pop**: the kill's own score pop, tinted. `ScorePopPool` gained a per-slot `tone` (`ScorePopTone` KILL /
    GOLD_RUSH); `scorePopTones` (pure, `scorePops.ts`) marks the kill pops that match a `goldRush` record of the frame
    (same x, z and points: the sim pushes both from one kill), each record once; `ScorePopController` colours those
    slots `BUILD_FX_VIEW.goldRush.role` (`boon.duo`) in the kill pool (no second pop, no new pool).
- **Settings.** Reduced halves the flare and glint segments (`buildFxCount`); reduced motion draws both at their end
  radius, fading only; quiet (stage cover, run over) and a new run forget them; records of a player outside the party
  are ignored. The Gold Rush tint follows the kill pops' `damageNumbers` gate and reduced-motion rise.
- **Audio.** Unchanged: the ember cue reads `embers` (now the feed's); duo sparks / bursts already play the spark /
  burst cues. No cue for the flare, glint or Gold Rush (a kill sound already plays).
- **Theme.** No new role, string or audio id (`boon.duo` is validated by the rarity report; the pop is text). No
  contract, validator or Luau-locals change.
- **Specs.** `view/fx/buildFxEvents.spec.ts` (embers from the feed only, not from an entry-less ember bullet; the duoProc
  split; the sim's own Gold Rush / Unshaken hooks), `view/fx/buildFxRules.spec.ts` (duo flares in `boon.duo`, Gold Rush
  and Unshaken none, outsiders ignored, Reduced / reduced motion; one beam and one flare for a Conductor spark; the glint
  following, restarting, ending; flare + heal + glint side by side, death and quiet), `view/fx/scorePops.spec.ts` (tone
  per slot; `scorePopTones` matching by x / z / points, each record once).

**Studio checklist, continued (nothing could run in Studio here).**

17. Storm Blade / Conductor / Chain Reaction / Close Call: a small ice-blue ring where the duo fired, next to (not
    instead of) the sky-blue beam or the bullets; Reduced: fewer segments.
18. Gold Rush at combo x3+: the kill's "+points" pop is ice-blue instead of the usual accent, one pop per kill (no
    duplicate); off with damage numbers.
19. Unshaken: an armor hit closes a quick ice-blue ring on the knight (following it), readable next to the hurt flash.

## BU13 tuning (as built, 2026-10-31)

Branch `builds-tune`. Measurements only: test support and spec files, **no gameplay number or rule changed**; the
recommendations at the end are owner calls. Harnesses: `run/testing/buildTune.ts` (build TTK, the kill probe, the player
bullet high-water) and `run/testing/buildOffers.ts` (offer statistics). Specs (each prints its table with a
`[builds tune]` prefix and asserts only loose bounds; headless runtimes in brackets): `sim/builds.ttk.pack.spec.ts`
(1.5 s), `sim/builds.ttk.room.spec.ts` (16 s), `sim/builds.ttk.boss.sword.spec.ts` (20 s), `.boss.bow.spec.ts` (34 s),
`.boss.deep.spec.ts` (25 s), `run/buildsPool.spec.ts` (7 s), `run/buildsOffers.spec.ts` (13 s).

**Method.** Every fight is solo in an open endless ARENA (an endless world with no rooms and the stairs out of reach, as
`builds/procs.spec.ts`; `builds` and `affixes` on, no drops), god mode (hearts refilled every tick, hits counted), the
build granted card by card through `grantCard` before tick 0. Hp comes from the sim itself: the state's endless floor and
Depth are set before anything spawns (Depth +1 per boss on the way: floors 1 / 6 / 11 = Depth 1 / 2 / 3), so
`spawnActor` scales every actor, slimelets, summons and boss adds included. Bots: the target is the nearest living actor;
the sword walks in and holds FIRE in reach (the full combo); the bow keeps 5 units and holds FIRE (the stream, no charged
shots), **leading** its target, strafing and staying off the arena's edges (EV13's centre-aiming, backing-off bow bot was
cornered under a swarmer or missed a strafing imp for minutes in mixed rooms, so this bot is a better player: no-build
bow numbers are faster than EV13's). A duo row holds its two boons at level I (their own effects included: Chain Spark's
sparks, Swift Strikes' 80 % recovery, Piercing Arrows' +1 pierce; Ember Wake's roll ring never fires, the bots do not
roll). **Effect kills** and **procs** come from a kill probe: for the fight every archetype is re-registered (same band)
as a copy whose `onHit` calls the original and, when the hit is about to kill, reads `ctx.procGen` (> 0: a spark, an
effect bullet or an ember made the kill) and repeats `buildsOnKill`'s queue test; the originals are registered back.
"queue" in the specs' output is the most procs still queued after a drain: at most 7 anywhere (Storm Crown on a pack),
so `PROCS_PER_TICK` 24 never binds. No fight dropped a weapon shot.

**1. Swarmer pack** (8 swarmers 5-7 units ahead, `procs.spec.ts`'s pack; run seeds 1-3, mean seconds to the last kill):

| build | sword s f1 / f6 / f11 (x no build) | bow s f1 / f6 / f11 (x no build) | effect kills f6 / f11 sword; bow | procs f11 sword / bow | max gen |
|---|---|---|---|---|---|
| no build | 1.4 / 1.4 / 1.8 (1.00 / 1.00 / 1.00) | 1.6 / 4.7 / 9.5 (1.00 / 1.00 / 1.00) | 0% / 0%; 0% / 0% | 0.0 / 0.0 | 0 |
| Chain Spark I | 0.3 / 0.7 / 1.0 (0.25 / 0.50 / 0.56) | 0.5 / 2.6 / 5.1 (0.30 / 0.55 / 0.54) | 21% / 33%; 25% / 25% | 8.0 / 8.0 | 3 |
| Storm Crown (Chain Spark III) | 0.3 / 0.3 / 0.7 (0.24 / 0.24 / 0.40) | 0.2 / 1.0 / 1.6 (0.14 / 0.21 / 0.17) | 67% / 50%; 88% / 88% | 8.0 / 4.0 | 3 |
| Volatile I | 0.4 / 0.6 / 1.1 (0.29 / 0.41 / 0.60) | 0.3 / 1.5 / 3.4 (0.20 / 0.32 / 0.36) | 58% / 46%; 75% / 13% | 7.7 / 8.0 | 3 |
| Cataclysm (Volatile III) | 0.4 / 0.4 / 0.8 (0.29 / 0.31 / 0.44) | 0.3 / 1.1 / 1.9 (0.20 / 0.24 / 0.20) | 67% / 71%; 88% / 75% | 7.0 / 6.0 | 3 |
| Soul Shards I | 0.4 / 0.6 / 1.0 (0.29 / 0.43 / 0.57) | 0.3 / 1.7 / 2.8 (0.21 / 0.35 / 0.29) | 54% / 50%; 63% / 38% | 8.0 / 8.0 | 3 |
| Soul Swarm (Soul Shards III) | 0.4 / 0.4 / 0.7 (0.28 / 0.31 / 0.40) | 0.3 / 1.1 / 1.8 (0.19 / 0.24 / 0.18) | 67% / 71%; 88% / 88% | 6.7 / 7.0 | 3 |
| Cataclysm + Chain Reaction (+ Chain Spark I) | 0.3 / 0.4 / 0.7 (0.25 / 0.28 / 0.39) | 0.3 / 1.1 / 1.9 (0.17 / 0.24 / 0.20) | 67% / 71%; 88% / 75% | 6.3 / 5.0 | 4 |
| Fire Arrows (Ember Wake + Piercing Arrows I) | 1.4 / 1.4 / 1.8 (1.00 / 1.00 / 1.00) | 0.9 / 1.6 / 2.6 (0.55 / 0.34 / 0.27) | 0% / 0%; 50% / 63% | 0.0 / 0.0 | 1 |
| Storm Blade (Chain Spark I + Swift Strikes I) | 0.3 / 0.5 / 1.2 (0.25 / 0.37 / 0.69) | 0.5 / 1.9 / 3.5 (0.28 / 0.40 / 0.37) | 29% / 33%; 63% / 38% | 7.7 / 8.0 | 3 |

**2. Mixed room** (per floor, among solo run seeds 1-10's rooms with the most distinct kinds, the one closest to the
floor's mean enemy count, with its planned affixes; spawns centred on the player, pushed out to `SPAWN_SAFE_RADIUS`; run
seeds 1-3). f1: run 3 room 9 (2 sniper, 2 swarmer, 1 bruiser); f6: run 5 room 11 (summoner, imp, slime, 2 bruiser,
sniper\*, 2 swarmer\*); f11: run 8 room 11 (slime\*, bruiser\*, imp, summoner, sniper\*, 3 swarmer, 2 swarmer\*);
\* = affixed. Procs per room are about one per kill (13-18 kills at f11 with slimelets and summons).

| build | sword s f1 / f6 / f11 (x no build) | bow s f1 / f6 / f11 (x no build) | effect kills f6 / f11 sword; bow | procs f11 sword / bow | max gen |
|---|---|---|---|---|---|
| no build | 3.9 / 14.6 / 19.2 (1.00 / 1.00 / 1.00) | 4.5 / 28.3 / 51.0 (1.00 / 1.00 / 1.00) | 0% / 0%; 0% / 0% | 0.0 / 0.0 | 0 |
| Chain Spark I | 3.9 / 11.9 / 18.8 (0.99 / 0.82 / 0.98) | 4.5 / 22.7 / 45.1 (1.00 / 0.80 / 0.88) | 10% / 13%; 8% / 11% | 17.3 / 18.0 | 2 |
| Storm Crown (Chain Spark III) | 3.9 / 10.5 / 14.5 (0.99 / 0.72 / 0.76) | 4.1 / 9.8 / 28.3 (0.91 / 0.35 / 0.55) | 28% / 25%; 40% / 37% | 16.0 / 18.0 | 2 |
| Volatile I | 3.9 / 13.0 / 17.5 (1.00 / 0.89 / 0.91) | 4.6 / 22.1 / 43.8 (1.01 / 0.78 / 0.86) | 10% / 12%; 2% / 20% | 17.3 / 17.7 | 3 |
| Cataclysm (Volatile III) | 3.9 / 12.0 / 17.9 (1.00 / 0.82 / 0.93) | 4.6 / 16.9 / 37.2 (1.01 / 0.60 / 0.73) | 17% / 17%; 43% / 33% | 16.0 / 15.7 | 3 |
| Soul Shards I | 3.1 / 10.7 / 17.1 (0.79 / 0.73 / 0.89) | 2.3 / 18.0 / 40.1 (0.52 / 0.64 / 0.79) | 21% / 12%; 17% / 20% | 16.7 / 17.7 | 3 |
| Soul Swarm (Soul Shards III) | 2.5 / 5.3 / 9.3 (0.63 / 0.36 / 0.48) | 2.1 / 6.2 / 16.5 (0.47 / 0.22 / 0.32) | 63% / 45%; 78% / 67% | 13.0 / 13.3 | 3 |
| Cataclysm + Chain Reaction (+ Chain Spark I) | 3.9 / 10.1 / 15.8 (0.99 / 0.69 / 0.82) | 4.5 / 14.6 / 32.6 (1.00 / 0.52 / 0.64) | 28% / 25%; 45% / 44% | 16.0 / 15.7 | 4 |
| Fire Arrows (Ember Wake + Piercing Arrows I) | 3.9 / 14.6 / 19.2 (1.00 / 1.00 / 1.00) | 3.2 / 13.1 / 20.0 (0.70 / 0.46 / 0.39) | 0% / 0%; 40% / 37% | 0.0 / 0.0 | 1 |
| Storm Blade (Chain Spark I + Swift Strikes I) | 3.4 / 8.9 / 15.5 (0.86 / 0.61 / 0.81) | 3.8 / 16.3 / 31.0 (0.83 / 0.58 / 0.61) | 11% / 15%; 29% / 33% | 16.0 / 17.7 | 3 |

**3. Mother Mayhem** (her own floors 5 / 10 / 15 = Depth 1 / 2 / 3: 540 / 810 / 1215 hp; a 26 x 26 boss room, the player
3 units inside its edge; seeds 1-2 at f5 / f10, seed 1 at f15). Her `damageCapPerSecond` 6 puts a floor under every fight:
hp / 6 = **90 / 135 / 202.5 s**.

| build | sword s f5 / f10 / f15 | bow s f5 / f10 / f15 (x no build) | effect kills (her adds) sword; bow f5 / f10 / f15 |
|---|---|---|---|
| no build | 98.2 / 146.9 / 219.0 | 117.8 / 179.7 / 284.0 (1.00 / 1.00 / 1.00) | 0% / 0% / 0%; 0% / 0% / 0% |
| Chain Spark I | 98.2 / 146.9 / 219.0 | 112.8 / 171.5 / 259.6 (0.96 / 0.95 / 0.91) | 3% / 0% / 0%; 26% / 6% / 0% |
| Storm Crown (Chain Spark III) | 98.2 / 146.9 / 219.0 | 111.7 / 166.6 / 255.2 (0.95 / 0.93 / 0.90) | 34% / 3% / 14%; 61% / 50% / 16% |
| Volatile I | 98.2 / 146.9 / 219.0 | 114.0 / 174.8 / 271.0 (0.97 / 0.97 / 0.95) | 0% / 0% / 0%; 13% / 6% / 4% |
| Cataclysm (Volatile III) | 98.2 / 146.9 / 219.0 | 112.3 / 169.9 / 261.4 (0.95 / 0.95 / 0.92) | 17% / 0% / 14%; 22% / 15% / 13% |
| Soul Shards I | 98.2 / 146.9 / 219.0 | 112.3 / 169.3 / 257.0 (0.95 / 0.94 / 0.90) | 0% / 0% / 0%; 30% / 22% / 16% |
| Soul Swarm (Soul Shards III) | 98.1 / 146.9 / 219.0 | 112.2 / 168.3 / 254.0 (0.95 / 0.94 / 0.89) | 37% / 31% / 36%; 61% / 59% / 53% |
| Cataclysm + Chain Reaction (+ Chain Spark I) | 98.2 / 146.9 / 219.0 | 111.7 / 168.2 / 254.8 (0.95 / 0.94 / 0.90) | 17% / 0% / 14%; 35% / 47% / 19% |
| Fire Arrows (Ember Wake + Piercing Arrows I) | 98.2 / 146.9 / 219.0 | 94.1 / 140.6 / 210.1 (0.80 / 0.78 / 0.74) | 0% / 0% / 0%; 58% / 52% / 58% |
| Storm Blade (Chain Spark I + Swift Strikes I) | 97.5 / 144.3 / 213.7 | 95.5 / 143.2 / 217.4 (0.81 / 0.80 / 0.77) | 34% / 8% / 0%; 25% / 20% / 11% |

**4. Player bullet high-water** (40 s, god mode, every player with the build, rolls every 1.5 s staggered; the densest
room by EV13's slot estimate of the run / floor, with its planned affixes, as an open arena: no wall ends a bullet early,
the pool's worst case). The heaviest builds: Cataclysm + Storm Crown + Chain Reaction + Soul Swarm (every on-kill boon at
III and the cross trigger), and Fire Arrows + Thrill Seeker at their heaviest (Ember Wake, Piercing Arrows III =
Ricochet, Swift Strikes III = Flurry, Daredevil III). "Weapon shots dropped" = `combat.dropped`'s rise minus the effect
bullets the budget refused (the enemy pool never filled).

| build | party | room (\* = affixed) | max player bullets | max effects all / one player | max own weapon bullets one player | effect bullets refused | weapon shots dropped | max enemy bullets | kills | cleared s |
|---|---|---|---|---|---|---|---|---|---|---|
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, sword | 1 | run 12 f19 room 0 (1 summoner\*, 3 slime\*, 7 slime, 1 bruiser, 1 sniper, 1 imp\*, 1 swarmer\*) | 160 | 160 / 160 | 0 | 221 | 0 | 62 | 39 | 19.0 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, bow | 1 | run 12 f19 room 0 (1 summoner\*, 3 slime\*, 7 slime, 1 bruiser, 1 sniper, 1 imp\*, 1 swarmer\*) | 75 | 74 / 74 | 3 | 0 | 0 | 83 | 10 | no |
| Fire Arrows + Thrill Seeker (+ Ricochet, Flurry), bow | 1 | run 12 f19 room 0 (1 summoner\*, 3 slime\*, 7 slime, 1 bruiser, 1 sniper, 1 imp\*, 1 swarmer\*) | 64 | 43 / 43 | 24 | 0 | 0 | 83 | 31 | no |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, sword | 1 | run 1 f6 room 11 (4 swarmer, 1 summoner, 1 sniper, 1 slime) | 148 | 148 / 148 | 0 | 0 | 0 | 18 | 9 | 3.7 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, bow | 1 | run 1 f6 room 11 (4 swarmer, 1 summoner, 1 sniper, 1 slime) | 101 | 100 / 100 | 2 | 0 | 0 | 1 | 11 | 3.1 |
| Fire Arrows + Thrill Seeker (+ Ricochet, Flurry), bow | 1 | run 1 f6 room 11 (4 swarmer, 1 summoner, 1 sniper, 1 slime) | 67 | 46 / 46 | 24 | 0 | 0 | 8 | 9 | 4.9 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, sword | 4 | run 17 f14 room 10 (11 slime, 1 summoner, 1 bruiser, 1 imp, 1 sniper, 1 swarmer) | 176 | 176 / 99 | 0 | 0 | 0 | 62 | 38 | 15.2 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, bow | 4 | run 17 f14 room 10 (11 slime, 1 summoner, 1 bruiser, 1 imp, 1 sniper, 1 swarmer) | 62 | 60 / 60 | 4 | 0 | 0 | 99 | 7 | no |
| Fire Arrows + Thrill Seeker (+ Ricochet, Flurry), bow | 4 | run 17 f14 room 10 (11 slime, 1 summoner, 1 bruiser, 1 imp, 1 sniper, 1 swarmer) | 208 | 157 / 56 | 24 | 0 | 0 | 74 | 44 | 22.6 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, sword | 4 | run 1 f6 room 10 (3 bruiser, 2 slime\*, 1 bruiser\*, 1 slime, 1 sniper\*, 1 imp, 3 sniper, 1 imp\*, 1 summoner) | 100 | 100 / 100 | 0 | 0 | 0 | 57 | 22 | 10.1 |
| Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, bow | 4 | run 1 f6 room 10 (3 bruiser, 2 slime\*, 1 bruiser\*, 1 slime, 1 sniper\*, 1 imp, 3 sniper, 1 imp\*, 1 summoner) | 91 | 85 / 79 | 4 | 0 | 0 | 105 | 24 | 25.4 |
| Fire Arrows + Thrill Seeker (+ Ricochet, Flurry), bow | 4 | run 1 f6 room 10 (3 bruiser, 2 slime\*, 1 bruiser\*, 1 slime, 1 sniper\*, 1 imp, 3 sniper, 1 imp\*, 1 summoner) | 221 | 167 / 57 | 24 | 0 | 0 | 80 | 24 | 9.2 |

**5. Offer statistics** (1000 simulated runs per policy on the real `drawCardOffers` and `BUILD_RULES`, one player, an
offer rng per run; one draft per floor cleared, two after floors 5 and 10 with the first deal's guaranteed duo; "by floor
N" = the build walking onto floor N: 6 picks by floor 6, 12 by floor 11). Policies: greedy = an evolution, else a duo,
else an upgrade, else the first card; random = a uniform card; duo-seeking = greedy, but a new boon that completes a duo
with an owned boon before an upgrade. The pity is detected exactly (the same rng state drawn again with the pity off).

| policy | by floor | runs with >= 1 evolution | runs with >= 1 duo | mean evolutions | mean duos | mean boons / levels | drafts offering an evolution / a duo | pity: drafts / runs |
|---|---|---|---|---|---|---|---|---|
| greedy | 6 | 100.0% | 8.8% | 1.80 | 0.09 | 2.14 / 5.91 | 30.0% / 1.5% | 3.5% / 19.4% |
| greedy | 11 | 100.0% | 45.9% | 3.42 | 0.52 | 4.33 / 11.48 | 28.5% / 4.7% | 2.5% / 26.3% |
| random | 6 | 65.3% | 10.4% | 0.71 | 0.10 | 3.51 / 5.89 | 31.4% / 5.4% | 5.0% / 26.4% |
| random | 11 | 97.6% | 45.3% | 2.28 | 0.53 | 5.68 / 11.47 | 47.7% / 13.4% | 4.8% / 42.1% |
| duo-seeking | 6 | 97.2% | 42.1% | 1.45 | 0.44 | 2.38 / 5.56 | 24.1% / 8.2% | 4.6% / 24.4% |
| duo-seeking | 11 | 100.0% | 93.9% | 2.82 | 1.50 | 4.52 / 10.50 | 23.5% / 14.3% | 4.1% / 39.4% |

The boss double draft's guaranteed duo was **available** (a duo in the pool at the first deal) after floor 5 / floor 10
in 7.7 % / 17.9 % of greedy runs, 14.9 % / 32.9 % random, 24.3 % / 31.2 % duo-seeking. Picks by kind: greedy new 36 % /
upgrade 31 % / evolution 29 % / duo 4 %; random 47 / 29 / 19 / 4; duo-seeking 38 / 26 / 24 / 13. One `BuildRules` change
at a time (by floor 11, greedy and random):

| rules | policy | by floor | runs with >= 1 evolution | runs with >= 1 duo | mean evolutions | mean duos | mean boons / levels | drafts offering an evolution / a duo | pity: drafts / runs |
|---|---|---|---|---|---|---|---|---|---|
| upgradePercent 25 | greedy | 11 | 100.0% | 46.2% | 3.41 | 0.52 | 4.35 / 11.48 | 28.4% / 4.8% | 5.5% / 49.3% |
| upgradePercent 25 | random | 11 | 94.7% | 49.4% | 2.01 | 0.59 | 6.08 / 11.41 | 43.0% / 15.4% | 10.3% / 71.3% |
| upgradePercent 45 | greedy | 11 | 100.0% | 46.1% | 3.42 | 0.52 | 4.33 / 11.48 | 28.5% / 4.8% | 1.1% / 11.8% |
| upgradePercent 45 | random | 11 | 99.0% | 42.1% | 2.50 | 0.49 | 5.36 / 11.51 | 50.1% / 12.7% | 1.9% / 20.1% |
| evolutionWeight 1 | greedy | 11 | 100.0% | 45.9% | 3.42 | 0.52 | 4.33 / 11.48 | 28.5% / 4.7% | 2.5% / 26.3% |
| evolutionWeight 1 | random | 11 | 96.2% | 46.0% | 2.19 | 0.54 | 5.69 / 11.46 | 45.2% / 13.5% | 4.8% / 42.8% |
| evolutionWeight 3 | greedy | 11 | 100.0% | 45.9% | 3.42 | 0.52 | 4.33 / 11.48 | 28.5% / 4.7% | 2.5% / 26.3% |
| evolutionWeight 3 | random | 11 | 98.2% | 45.1% | 2.33 | 0.53 | 5.68 / 11.47 | 48.2% / 13.4% | 4.7% / 41.9% |
| duoPercentBase 30 | greedy | 11 | 100.0% | 46.0% | 3.42 | 0.52 | 4.33 / 11.48 | 28.5% / 4.6% | 1.4% / 15.9% |
| duoPercentBase 30 | random | 11 | 98.6% | 43.5% | 2.39 | 0.51 | 5.54 / 11.49 | 48.8% / 13.4% | 2.8% / 28.6% |
| upgradePityCards huge (no pity) | greedy | 11 | 100.0% | 46.8% | 3.41 | 0.53 | 4.34 / 11.47 | 28.4% / 4.9% | 0.0% / 0.0% |
| upgradePityCards huge (no pity) | random | 11 | 96.1% | 47.2% | 2.18 | 0.57 | 5.78 / 11.43 | 45.8% / 14.1% | 0.0% / 0.0% |

**Readings.**

- **Packs melt, as designed.** Any on-kill boon at level I clears the 8-swarmer pack 1.7-5x faster (x 0.20-0.60), level
  III 2.3-7x (x 0.14-0.44); with the bow at f11 every level-III on-kill build is x 0.17-0.20 and effects make 75-88 % of
  the kills. Generations reach the cap (gen 3; 4 only with Chain Reaction, its cross trigger's kills).
- **Mixed rooms are where builds separate.** Level I is mild (sword x 0.73-1.00, bow x 0.52-1.01; a floor-1 room of
  snipers and a bruiser barely notices). Level III, sword / bow at f6 and f11: Storm Crown x 0.72-0.76 / 0.35-0.55,
  Cataclysm x 0.82-0.93 / 0.60-0.73, **Soul Swarm x 0.36-0.48 / 0.22-0.32** (the outlier: its shards fly 8 tiles and
  steer, so they are a ranged weapon for the sword player, and the bot takes 3-7 hits instead of 12-17), Cataclysm +
  Chain Reaction x 0.69-0.82 / 0.52-0.64. **Fire Arrows** (3 picks, no evolution needed) is the strongest bow build per
  pick: x 0.46 / 0.39 with 37-40 % of the kills by embers; it does nothing for the sword. Storm Blade x 0.58-0.86 with
  either weapon (part of it Swift Strikes I). Effects make 10-63 % (sword) and 2-78 % (bow) of a room's kills at f6 /
  f11.
- **Bosses are capped, not built.** Mother Mayhem's 6 damage / s cap (her own data, older than builds; the Demon Lord's
  is the same 6) binds the sword already: 98 / 147 / 219 s with every build (only Storm Blade, through Swift Strikes,
  shaves 1-2 %). The bow (5 dps flat out) gains 3-11 % from on-kill boons (only her adds proc: 11-25 procs a fight) and
  19-26 % from Fire Arrows and Storm Blade (Swift Strikes I lifts the stream to 6.25 dps, over the cap), ending 4-7 %
  above the cap's floor. No build can shorten her below hp / 6, so at Depth 3 every Mother Mayhem fight lasts over 3.4
  minutes.
- **Pool: the BU3 budgets hold with room to spare.** No weapon shot dropped in any run. One player's effects hit
  `EFFECT_BULLETS_MAX` 160 only with the sword's full on-kill build in the 15-enemy floor-19 room (221 effect bullets
  refused in 40 s). The most player bullets ever alive: 221 of 512 (party 4, Fire Arrows + Thrill Seeker, floor 6), far
  below the 384 effects may take in a party of 4 (512 - 4 x 32). A player's own weapon bullets peaked at 24 (Fire Arrows
  with Flurry's triples) of the 32 reserved. Enemy bullets peaked at 105 of 2048.
- **Evolutions are easy, duos are rare.** The upgrade pity puts an upgrade card in every full draft of a player who owns
  an upgradable boon, so a greedy player evolves in every run by floor 6 (1.8 evolutions; 3.4 by floor 11) and even a
  random picker has 2.3 by floor 11; the pity itself fires in only 2.5-5 % of drafts. Duos: 9-10 % of runs by floor 6,
  45-46 % by floor 11, **0.5 per run** for greedy and random players, against the plan's "1-3 duos" (the plan's 2-3
  evolutions are met or beaten). Only a player who chases partners gets there (duo-seeking: 94 %, 1.5 per run). The boss
  draft's guarantee rarely has anything to guarantee (8-24 % at floor 5, 18-33 % at floor 10). No `BuildRules` number
  moves duos by more than about 4 points: the bottleneck is owning both boons of a pair (`duoPercent` only acts once a duo is
  available), while `upgradePercent` mostly moves how often the pity fires (25: in 49-71 % of runs; 45: 12-20 %).

**Recommendations (owner calls; nothing changed here).**

1. **Duos: make partners findable** (the one number the measurements say is off). Options, in order of reach: (a) a
   partner bias in the new-card pick: an unowned boon that completes a duo with an owned boon weighs x2-x3 within its
   rarity (a rule change in `drawCardOffers`; every builds run's offers draw differently); (b) the boss double draft's
   guarantee falls back to such a partner card when no duo is available (boss floors only); (c) accept duos as the reward
   for playing toward them (duo-seeking already reaches 94 %). Suggested: (b), then (a) at x2, re-measured with
   `buildsOffers.spec.ts` (target: >= 1 duo in ~75 % of greedy / random runs by floor 11). Raising `duoPercent` alone
   does nothing.
2. **Upgrade odds: no change** (`upgradePercent` 35, `evolutionWeight` 2, pity after 3 cards). Evolutions already land by
   floor 6 for a player who wants them; `evolutionWeight` barely matters (+-0.1 evolutions for a random picker).
3. **Soul Swarm: watch, no change yet.** It is the room outlier (x 0.22-0.48; the next level-III build x 0.35-0.93), which
   is the "feels broken" moment the plan wants. If BU14's play says it dominates: 4 -> 3 shards at III
   (`SOUL_SHARD_SPECS[2]` count) or a lower `SOUL_SWARM_TURN`.
4. **Fire Arrows: keep** (the owner's example duo); the lever if bows converge on it is `FIRE_ARROWS_EMBERS_MAX` 4 -> 3.
5. **Budgets: keep** `EFFECT_BULLETS_MAX` 160, `effectWeaponReserve` 32, `PROCS_PER_TICK` 24, `GEN_MAX` 3 (no weapon shot
   dropped, own fire peaks at 24, the queue never carries more than 7).
6. **Boss cap (not a builds number, flagged).** Builds cannot speed up a boss beyond `damageCapPerSecond` 6, and Depth
   scales boss hp but not the cap, so Mother Mayhem takes >= 90 / 135 / 202.5 s at Depth 1 / 2 / 3. If deep boss fights
   should stay near today's floor-5 length and reward builds, scale the cap with `depthHpMultiplier` (both bosses; an
   endless replay change). Otherwise accept: the boss is the build-proof test.

**Not measured.** Real floor geometry (walls and pillars stop effect bullets; the arenas are the pool's worst case and an
optimistic case for TTK: the bow bot could not clear a dense real room in 40 s, so every run here is an arena), party
TTK (the pool runs are a party of 4, but no party TTK table), the Demon Lord (same cap, so the same boss reading is
expected), relics, curses and boosts, human play (no dodging or charged shots; god mode), and real run length (the offer
statistics assume a run reaches floor 11). The offer simulation draws from its own rng per run, not interleaved with a
real run's combat draws (same rules and generator, different sequences).

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
  **`builds`, appended LAST** (after `affixes` and `dev`); `hashLayout.ts` names it.
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
  **Boons part, as built (2026-11-08; presentation only).** Every boon (all 17, not just the 3 on-kill ones) has an
  ORIGINAL 16 x 16 icon from `scripts/art/gen-boon-icons.js` (owner picks: full colour in the dark red UI's palette,
  evolutions reuse their boon's icon, duo icons deferred: a duo shows its two boons' icons), in its own sheet
  `boon-icons.png` (18 x 306, art/atlases.json `boonIcons`, `packs/vale/boonIconLayout.ts`) instead of `ui-icons.png`,
  so the shipped icon atlas never repacks. Theme ids `ui.boon.<name>` (shared/theme `boonIconId`). Drawn in the items
  row (status panel and touch chips: the art on a dark cell, the rarity / duo colour as outline and pips; evolved frame
  unchanged) and on draft cards (a Duo chip's halves; a boon card's own one-cell chip in the banner row). Budget: one
  18 x 306 PNG (5.5 K px), one content id in the core preload tier. Specs: `gen-boon-icons.test.js` (palette,
  outline, the group, the committed layout), `valeBoonIcons.spec.ts`, `buildHud.spec` / `draftCards.spec` (art and
  its fallback). Open: upload `art/upload/boon-icons.png` and paste its id into `assetIds.ts`; Studio check of the
  longest Evolution banner row (chip + "EVOLVE · Piercing Arrows" + pips inside the card) and the portrait column;
  effect sprites and duo / evolution icons of their own (if wanted).
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

## Review (2026-10-31)

An independent read of `5a0edc2..c450591` found **no desync hazard and no gating leak** (hashing, clones, the
`unshakenKept` same-tick read, iteration order, arithmetic, `drawBoonOffers` / tutorial / M1 paths all checked). Its four
low findings:

1. **Fixed.** `DraftRevealController` detected a boss double draft's re-deal only by the draft timer dropping; a co-op
   catch-up frame could step past it and keep the first deal's faces. A change of the offers now counts too.
2. **Fixed (hardening).** `fireBurstLimited`'s limit and the builds modules' per-tick scratch (Ricochet, queued duo
   sparks, Chain Reaction crosses, embers, the effect budget's session, volley targets) are reset at the top of
   `stepCombat`: the burst limit every tick (`resetBurstLimit`), the builds scratch whenever `stepCombat` is bound to a
   different state than last time (`resetBuildScratch(state)`), so a tick that threw under a validator's pcall cannot
   leak into the next run in the same VM. A no-op after a normal tick; no hash change.
3. **Owner call.** A dead co-op player's queued procs, and kills by their bullets still in flight, still fire Chain
   Spark / Volatile / Soul Shards, while every evolution and duo release needs the owner alive and present. BU3 only
   specified dropping leavers' procs. Keep (effects in flight finish) or drop them on death.
4. **Open (cosmetic).** `BuildFxController`'s colour cache is never cleared, so a theme pack switch mid-session keeps
   the old effect colours until the next session.
