# Floor modifiers: know it before you see it

Status (2026-11-12): **plan, decisions FMD1-FMD12 answered by the owner (2026-11-12); FM0 next.** Two answers
changed the plan: twists are allowed (FMD1), and Blood Moon now means **twice the elites** (FMD5), which makes all of
wave 1 floor-built (no sim state). One owner call is open: OC1, which other twists (if any) join wave 1. Planned against `main` @ `677b5b1` (Fortune,
treasure rooms, pellets, affixes and the stage loader merged; the working tree's uncommitted audio / DSD18 work, with
`DAILY.ruleset` 16, is not assumed). Work it task by task like `PLAN.md`; each task ends with a **Verify**. Project
copy: `claude/floor-modifiers-plan.md`. Related: docs/STAGE_LOADER.md (the card), docs/FORTUNE.md (the Goldling),
docs/TREASURE.md (vaults), docs/PELLETS.md (the power pellet), docs/BREAKABLE_DROPS.md (loaded pieces),
docs/ENEMY_VARIANTS.md (elite affixes), docs/BOOSTS.md (drops), docs/GOLDLING_RUMOURS.md (pending, composes with
Gilded).

Goal: some floors are **special, and the floor card says so**. You take the stairs, the card cuts in, `Floor 6 ·
Ancient Halls`, and under it a gold banner stamps in: **Gilded** · *A Goldling is certain*. Before the floor is even
on screen you know something good is waiting, and you play the floor hunting for it.

Wave 1 (five modifiers, every one **true**; four boons and one twist, FMD1):

| Id | Kind | Card | What it does | Built from |
|---|---|---|---|---|
| `gilded` | boon | **Gilded** · A Goldling is certain | The floor's Goldling roll always hits | `placeGolden` |
| `hoard` | boon | **Hoard** · A treasure vault is certain | The floor's vault roll always hits | `placeVault` |
| `feast` | boon | **Feast** · A power pellet is certain | The floor's power pellet roll always hits | `placePellets` |
| `plunder` | boon | **Plunder** · Every fight room hides a boost | One loaded barrel / crate in every room that has pieces | `placeBreakableLoot` |
| `bloodMoon` | twist | **Blood Moon** · Twice the elites | Every affix share on the floor doubled: more Hulking / Swift / Shielded / Vengeful enemies, each still paying its x1.5 kill points and +4 drop points | `assignAffixes` |

**Sim impact: gameplay, opt-in, endless only, all floor-built.** Every wave 1 kind only changes an existing floor-built
roll in shared/dungeon, so it changes nothing but that floor's existing outputs, which already reach the sim and its hash
through their own groups (golden, treasure, pellets, drops, affixes). No new sim state, hash group or sim rule: the view
reads the modifier from the floor layout. (A later kind with a sim rule, e.g. wave 2's Twin Draft, adds opt-in
`SimConfig.modifiers` and a `modifiers` hash group appended last.) M1, every golden fixture and the tutorial replay
exactly as before; endless / daily / dev replays and scores change on modifier floors (boards stay `_v1`,
`DAILY.ruleset` + 1).

Rules that keep it kind: a modifier **never lies** (it is only picked where its effect is certain to exist, FMD3), a
twist **always names its edge plainly** and comes with a reward the game already pays (elites' points and drop bonus),
and **missing a boon costs nothing** (an ignored Goldling still runs off as today). Boons and twists look different on
the card (gold vs blood-red banner) so "something good" and "something dangerous" never read alike.

## What the code gives us (read in the source at 677b5b1 unless marked assumed)

| Fact | Where | Consequence |
|---|---|---|
| Every floor-built extra is a pure function of the floor seed on its **own salted stream**, run in a fixed order in `buildEndlessFloor`: roster, room spawns, breakables, affixes, loot, pellets, vault (opt-in `vaults`), pact altars, Goldling | `shared/dungeon/endless.ts` | A modifier can be one more pure step with its own salt: every client, the server's validator and a daily seed agree, nothing above moves |
| `placeGolden`: from floor 2, ONE chance draw `rng.int(0, 99) < 30 / 35 / 40` by band, then ONE weighted room draw over `goldenEligibleRooms` | `dungeon/golden.ts`, `goldenData.ts` | "Certain" = make the chance draw and ignore its result: the room draw is the same draw as on a natural hit |
| `placeVault`: from floor 2, ONE chance draw (40 / 50 / 55 %), then room, tier, lock; `VaultOverride.every` already forces the hit (the dev world's `KV_TreasureDebug`) | `dungeon/vault.ts` | Hoard is `every: true` exactly: the code path exists and is specced |
| `placePellets`: from `power.fromFloor` 2, when some room got pellets, ONE draw `< 33`, then the pellet index | `dungeon/pellets.ts`, `pelletsData.ts` | Feast forces that one draw's result, same following draw |
| `placeBreakableLoot`: count `rng.int(min, max)` by band (0-2 / 1-2 / 1-3 / 1-3), at most `maxPerRoom` 1, weighted pieces | `dungeon/breakableLoot.ts` | Plunder sets the count to "every room with a weighted piece"; extra draws on the loot stream only |
| Affixes: elite rooms from floor 4 (`eliteSharePercent` 35 of eligible members, rounded up, >= 1), combat rooms from floor 11; on their own stream (`floorSeed ^ 0xcc9e2d51`); `roomAffixes` per planned spawn on the floor world; the sim stamps them in `spawnActor` | `dungeon/affixesData.ts`, `affixes.ts`, `sim/affixes` | Blood Moon is `assignAffixes` with doubled shares (capped at the eligible members): floor-built, no sim change. Its eligibility is a count over floor data |
| Affixed kills already pay: x1.5 kill points (`killPointsPercent` 150), +4 drop points (`dropChanceBonus`), +`AFFIX_PAR_COST` on the room's par | `sim/affixes/affixesData.ts` | Blood Moon's reward is built in: twice the elites is twice their points and drop chances |
| Floor-built outputs already reach hashed state per floor (`dropsOnFloorPieces`, `goldenOnFloor`, `pelletsOnFloor`, affixes in `spawnActor`) | `sim/endless.ts`, `sim/state.ts` | Wave 1 needs no new state: the forced outputs flow through the existing paths and hash groups |
| The floor card (`StageCard`): title `Floor {floor}`, biome, `Boss floor`, ONE second line (`stageCardLine`: NEW DEEPEST > roster `New: Imp` > best `2 to go`); `minCardSec` 0.6 s; a world live under the card (no draft) has no minimum; `holdAtLeast(sec)` lengthens a cover (the run start's roster line uses it) | `client/ui/loading/StageCard.tsx`, `client/controllers/game/StageController.tsx`, `shared/view/stageLoader.ts` | The banner is two new rows; a modifier floor calls `holdAtLeast` so it can be read. On a draft floor the world is frozen, so a longer card costs no play time, solo or co-op |
| The card reads the floor through `ctx.endlessFloor(ctx.floor)` (layout: `bossFloor`, `roster`) | `StageController.begin` | The modifier is one more layout field; no new remote |
| Floor n + 1 is pre-generated during floor n's draft (solo); co-op builds it mid-tick on the stairwell tick | docs/STAGE_LOADER.md SD1, SL7 | The card always has the floor. A *stairwell teaser* (knowing n + 1's modifier while on n) works solo only without a co-op pre-gen: out of wave 1 (FMD10) |
| `HordeChip` in the status corner's boost row and the touch strip | `client/ui/hud/HordeChip.tsx`, `StatusPanel.tsx`, `TouchStrip.tsx` | The in-run reminder copies it |
| Port audio IDs: `PORT_AUDIO_EVENTS`, SILENT in the placeholder, `SFX_FALLBACK`, `SFX_PRIORITY`; `sfx.floor.enter` plays on `floorChanged` (68) | `view/audio/cues.ts` | One sting per kind `sfx.floor.modifier.<id>` (FMD9), after the enter cue |
| Dev world: `startFloor`, `vaultOverride`; `KV_TreasureDebug` | `shared/run`, docs/DEV_MODE.md | A dev override `KV_FloorModifier` to force a modifier on every floor |

## Player experience

| When | What you see | What you hear |
|---|---|---|
| Take the stairs to a modifier floor | The card: `Floor 6`, `Ancient Halls`, then 0.3 s later the banner stamps in: the name big in the modifier's colour (`Gilded` in gold; a twist like `Blood Moon` in blood red), its line under it (`A Goldling is certain` / `Twice the elites`), a small icon left of the name once art exists. The card holds 1.8 s instead of 0.6 s, then fades into the draft as today | `sfx.floor.enter` (as today), then the kind's own sting on the stamp (`sfx.floor.modifier.<id>`; a twist's sting reads ominous, a boon's bright) |
| Play the floor | A chip in the status corner (and the touch strip): icon + `Gilded`, steady. Pause overlay: the name and its line under the floor info | Nothing more |
| The promise pays off | The chip pulses once: the Goldling appears (Gilded), the vault room engages (Hoard), the power pellet is eaten (Feast), the first elite room engages (Blood Moon), the first loaded piece breaks (Plunder) | Nothing new (the payoff's own sounds) |
| Leave the floor | The chip goes with the floor | |
| A plain floor | Today's card exactly (0.6 s, the one second line) | Today's |

- **Card order:** title, biome, *banner name*, *banner line*, then the existing one line (NEW DEEPEST / roster / best).
  Never on boss floors (FMD4), so `Boss floor` and a banner never meet.
- **Co-op:** every client builds the same floor (party size included), so everyone sees the same banner. The hold only
  applies when the local draft is open (the world is frozen); a live world under the card shows the banner without the
  hold, and the chip carries it.
- **Reduced motion:** the banner cuts in with the rest (no stamp, no chip pulse).
- **Muted:** the banner and chip say everything; the sting is flavour.
- **Daily:** the day's seed decides its modifiers, so every player meets the same Gilded floor 3: a talking point.

## Rules

- **Worlds:** wherever `SimConfig.modifiers` is set: endless solo / co-op, daily, dev. Never M1 or the tutorial.
- **Floors (FMD2):** from floor `MODIFIERS.fromFloor` 2, never a boss floor, never two floors in a row.
- **Chance (FMD2):** one draw on the modifier stream `EncounterRng(floorSeed ^ MODIFIERS.salt)`: 20 % floors 2-4,
  25 % 5-9, 30 % 10+ (`MODIFIERS.bands`). Not two in a row: floor n gets none when floor n - 1's chance draw hit (its
  draw alone, cheap: no build of n - 1; a hit with no eligible kind still counts, so the real rate is a little lower,
  measured in FM9).
- **Kind:** on a hit, ONE weighted draw over the kinds (`MODIFIERS.kinds`, weights FMD6: the big payoffs rarer, starting
  Gilded 1 / Hoard 1 / Feast 2 / Plunder 2 / Blood Moon 2, tuned in FM9) gives a start index; the kinds
  are then tried in table order from it, and the **first eligible** one wins (one draw, never a reroll). None eligible:
  no modifier.
- **Eligibility (honesty, FMD3), read from the floor built without modifiers:**
  - `gilded`: `SimConfig.golden` on the world, floor >= `GOLDEN_PLACE.fromFloor`, `goldenEligibleRooms` non-empty, and
    the floor's natural roll MISSED (FMD7: Gilded never lands on a floor that had a Goldling anyway, so it always adds
    one).
  - `hoard`: vaults on, floor >= `VAULT.fromFloor`, `vaultRooms` non-empty, the natural roll missed.
  - `feast`: pellets on, some room got pellets, floor >= `PELLETS.power.fromFloor`, the natural roll missed.
  - `plunder`: drops with `breakableLoot` on, at least `MODIFIERS.plunder.minRooms` 3 rooms with a weighted piece.
  - `bloodMoon`: affixes on, floor >= `AFFIXES.eliteFromFloor` 4, and the doubled shares give at least
    `MODIFIERS.bloodMoon.minExtra` 2 more affixed planned members than the natural assignment (outside the boss room), so
    "twice" is never a rounding non-event.
- **Effects (all floor-built):** the affected placer is run again with its force flag (`placeGolden(..., { certain })`,
  `placeVault` with `every`, `placePellets(..., { powerCertain })`, `placeBreakableLoot(..., { everyRoom })`,
  `assignAffixes(..., { sharePercent: 200 })`), and every placer after it in `buildEndlessFloor`'s order (the pact
  altars after a Hoard chest; the vault after a Feast pellet). A forced roll still makes its chance draw, so the draws
  after it are the natural hit's.
  - `bloodMoon` (FMD5, owner: "double the elites"): elite rooms' share 35 -> 70 %, combat rooms' share (from floor 11)
    doubled too, both rounded up and capped at the room's eligible members; the same kinds stay excluded (bosses, the
    Goldling, the dummy, summoned adds). Their existing rewards apply unchanged. Drops are not changed.
- **State:** none new. `EndlessFloorLayout.modifier` / `EndlessFloorWorld.modifier` is floor data the view reads; the
  forced outputs reach the sim and its hash through their existing paths.

## Design

1. **Dungeon** `shared/dungeon/modifiers.ts` + `modifiersData.ts` (a leaf): `FloorModifier { NONE 0, GILDED 1,
   BLOOD_MOON 2, HOARD 3, FEAST 4, PLUNDER 5 }` (append only), `FloorModifierClass { BOON, TWIST }`, `MODIFIERS` (salt,
   fromFloor, bands, kinds with class and weight, plunder / bloodMoon numbers), `modifierChanceHit(floorSeed, floor)`
   (the one chance draw, also used for floor n - 1), `pickFloorModifier(input, layout, options)` (pure). The five
   placers gain an optional trailing force flag (absent: byte-identical; a lock spec per placer). `buildEndlessFloor`
   builds as today, picks, then re-runs from the affected placer; `EndlessFloorLayout.modifier` /
   `EndlessFloorWorld.modifier`. Opt-in `EndlessFloorOptions.modifiers` (with the world's flags: golden / vaults /
   pellets / breakable loot / affixes, so eligibility matches what the sim will run).
2. **Sim:** nothing in wave 1 (FMD5 made Blood Moon floor-built). The world's `EndlessFloorWorld.modifier` is carried
   for the view only.
3. **Run configs** (`shared/run`): endless, daily, dev pass `modifiers` in their floor options; M1, the tutorial and
   every fixture do not. `DAILY.ruleset` + 1. Dev: `modifierOverride` from `KV_FloorModifier` (`every` + a kind) like
   `vaultOverride`, dev world only.
4. **View core** `shared/view/modifiers/`: `FLOOR_MODIFIER_VIEW` (banner delay 0.3 s, `modifierCardSec` 1.8, chip pulse
   0.6 s / 0.1), `modifierCardRows(kind)` (string keys, role, icon id, class), `ModifierPayoff` (pure: which frame's
   events pay the promise off: `GoldenFrameEvents.appeared`, the vault record's engage, the power pellet's pickup, the
   first elite room's engage, the first `fromPiece` landing).
5. **The card** (`StageController`, `StageCard`): `clientStore.showStage({ ..., modifier })`; on a modifier floor
   `load.holdAtLeast(modifierCardSec)` unless `worldLive`; two rows after the boss row; the stamp through a binding
   StageController steps (no re-render per frame). A dev run starting past floor 1 shows it on the run-start cover like
   the roster line. Fits the smallest phone (fit.spec).
6. **Chip** `FloorModifierChip` beside `HordeChip` (status corner, touch strip), and a line in the pause overlay.
7. **Theme:** strings `floorMod.<id>.name` / `.line` (10, l10n context entries), `hud.chip.floorMod` if a template is
   needed; colour roles `FLOOR_MODIFIER_ROLES` `floorMod.gilded` (`golden.coin`'s hex), `.bloodMoon` (a deep red, new),
   `.hoard` (`treasure.legendary`'s), `.feast` (`pellet.power`'s), `.plunder` (a boost green), validated >= 4.5:1 on
   `background` and `uiPanel` and the twist red >= 40 CIE76 from every boon's (`floorModifierReport`); optional ui ids
   `ui.floorMod.<id>` (all or nothing); port audio IDs `sfx.floor.modifier.<id>` (five, FMD9; SILENT in the placeholder,
   fallbacks boons -> `sfx.jingle.treasure`, twists -> `sfx.horde.horn`, priority under the enter cue).
   Keep `contract.luau` / `validate.luau` under 200 top-level locals (counted on out/).
8. **Art (optional, FM11):** five 16 x 16 icons, original pixel art by `scripts/art/gen-floormod-icons.js` (the boon
   icons' kit), its own sheet `floormod-icons.png` (`--only floorModIcons`), like the boost icons.
9. **Debug:** `KV_FloorModifier` (dev), the modifier on the `KV_Debug` floor line, `[Stage] floor 6: modifier gilded`.

## Tasks

- [ ] **FM0. Confirm the code assumptions.** Each placer's draw order (a forced hit really leaves the following draws
  as a natural hit's); what reads `pellets.power` and the chest downstream; affixed members in the boss room on boss
  floors (excluded anyway); `holdAtLeast` on a floor change; the card's height on the smallest phone with five rows;
  that co-op's mid-tick build of floor n + 1 sets the modifier before the card shows. → Verify: each table row marked
  read or corrected here.
- [ ] **FM1. Modifier pick** (`dungeon/modifiers*.ts`). → Verify (spec): no modifier on floor 1, boss floors, or after a
  hit floor; bands' rates over runs 1-60 x floors 2-30 (printed); every pick eligible; the salt unique among the floor
  salts; the pick never moves layouts, digests, spawns, pieces, affixes, pellets, vault, altars or Goldling on floors
  without a modifier (`roomPool.lock.spec` digests unchanged with the option off).
- [ ] **FM2. Forced placers.** `certain` / `every` / `powerCertain` / `everyRoom` / `sharePercent`. → Verify: absent
  flag byte-identical (lock specs); forced = the natural hit's room / pellet / tier when the natural roll hit (same
  draws); downstream re-run (altars after Hoard); Blood Moon's affixed count about twice the natural one, never on
  excluded kinds, capped at eligible members.
- [ ] **FM3. Replays.** No sim change: M1, every golden fixture and the tutorial bit for bit; endless with modifiers
  deterministic; the determinism pins (charger / stormcaller / vault) re-recorded where endless moved.
- [ ] **FM4. Run configs, daily, dev.** → Verify: endless / daily / dev on, M1 / tutorial off; `DAILY.ruleset` + 1;
  `KV_FloorModifier` dev world only and never submitted; the server validator builds the same floors.
- [ ] **FM5. The card.** → Verify (Studio): banner on a modifier floor, the 1.8 s hold, no hold with a live world,
  reduced motion cut, no banner on plain floors, the run-start cover in a dev run from floor 6; phone fit.
- [ ] **FM6. Chip, pause line, payoff pulse.** → Verify: each kind's payoff pulses once; touch strip; beside `HORDE`.
- [ ] **FM7. Theme: strings, roles, audio ID.** → Verify: contract / validator specs, `floorModifierReport`, l10n check,
  Luau locals counted.
- [ ] **FM8. Docs.** This doc's as-built, FORTUNE.md / TREASURE.md / PELLETS.md / BREAKABLE_DROPS.md / BOOSTS.md cross
  references, STAGE_LOADER.md (the banner), DAILY.md (ruleset), CLAUDE.md docs row and decision log.
- [ ] **FM9. Census and tuning.** Runs 1-60 x floors 2-30, solo and party 3: modifier floors per run (target about one
  in five non-boss floors), the kind mix, eligibility misses, Blood Moon's affixed members per floor (natural vs
  doubled) and the bot's deaths / clear time on those floors, Plunder loaded pieces, score change per kind (Gilded's
  catch is 1500 x floor scale). → Verify: numbers recorded; FMD2 /
  FMD6 tuned.
- [ ] **FM10. [owner] Audio:** pick the five stings (`art/audio-audition.html`): boons bright, the twist ominous.
- [ ] **FM11. Icons (optional).** → Verify: the sheet's lock, the card and chip with and without the art.
- [ ] **FM12. [owner] Studio check and playtest** (below). The question: do players read the banner, and do they change
  how they play the floor?
- [ ] **FM13. Telemetry (optional).** Per modifier floor: kind, payoff reached (Goldling caught, vault opened, power
  pellet eaten, Blood Moon elites killed), death on the floor.

## Decisions (answered by the owner, 2026-11-12)

- **FMD1. Only good? -> Some twists.** Twists are allowed, as long as the card names the edge plainly and the floor pays
  for it with a reward the game already has. Wave 1's twist is Blood Moon (FMD5). Twists get a blood-red banner and an
  ominous sting; boons a gold banner and a bright one. *Open (OC1): which other twists, if any, join wave 1* (e.g.
  "Swarm: twice the enemies, x2 score", which overlaps the Horde pact, would need a sim rule and the `modifiers` group).
- **FMD2. Frequency -> about one floor in five** (recommended): 20 / 25 / 30 % of non-boss floors by band from floor 2,
  never two in a row.
- **FMD3. Honesty -> only where certain** (recommended): eligibility checks on the built floor; the only accepted miss
  is a Goldling SKIPPED by a full actor pool.
- **FMD4. Boss floors -> never** (recommended).
- **FMD5. Blood Moon -> "double the elites"** (owner): not double drops but twice the affixed enemies (every affix share
  doubled, capped at eligible members). The card line is **Twice the elites**. Floor-built, so wave 1 needs no sim
  change; the reward is the elites' existing x1.5 points and +4 drop points.
- **FMD6. Weights -> big payoffs rarer:** Gilded 1, Hoard 1, Feast 2, Plunder 2, Blood Moon 2 to start; FM9 tunes.
- **FMD7. A floor that had it anyway -> not eligible** (recommended): Gilded / Hoard / Feast only where they add one.
- **FMD8. Card hold -> 1.8 s when the draft is open** (recommended); no hold with a live world.
- **FMD9. Sting -> one per kind:** five port audio IDs `sfx.floor.modifier.<id>`, auditioned in FM10.
- **FMD10. Teaser -> card only for now** (recommended); the stairwell glow waits for a co-op pre-generation.
- **FMD11. Flavour -> banner and chip only** (recommended); per-kind ambience is a later wave.
- **FMD12. Wave 2 -> plan Blessed and Twin Draft next:** *Blessed* (the shrine offers a free relic) and *Twin Draft*
  (the next draft deals four cards); both need sim rules, so wave 2 brings `SimConfig.modifiers` and the `modifiers`
  hash group. Fever and Bounty Hunt dropped for now.

## Risks

- **Blood Moon's difficulty.** Twice the elites on floors 4-10 means elite rooms where most members are affixed; FM9
  watches the bot's deaths and clear times there, and the share can come down from 200 % if it spikes.
- **Strength of the boons.** Plunder hands out more boosts (the ground cap of 4 bounds it); every kind raises its
  floors' scores (boards stay `_v1`).
- **Eligibility vs build order.** The pick reads the floor built without modifiers; a forced placer re-runs its
  downstream. FM2's specs pin that a forced floor equals a natural hit.
- **Card fit.** Five rows on the smallest phone; FM5's fit spec.
- **Reading twists as gifts.** A child may read any banner as good news; the red banner and ominous sting must make
  Blood Moon read as a warning. FM12 checks it.
- **Composition.** A Gilded floor with Goldling rumours (pending) tells the same news twice; fine, the rumour then says
  *where*. Hoard + Horde pact in the same room composes as treasure + fortune already do; Blood Moon + Horde makes a hard
  second wave (the wave has no affixes, FORTUNE.md).

## Studio check

Dev panel (**F2**), `KV_FloorModifier` = `gilded` (then each kind), start floor 4:

- Card: `Floor 4 · ...`, the banner stamps in, 1.8 s, the draft; the chip in the status corner.
- Gilded: `KV_GoldenLabel` shows a Goldling on the floor; the chip pulses when it appears.
- Hoard: a vault on the minimap's vault mark; Feast: the power pellet; Plunder: every fight room's glint; Blood Moon:
  the elite rooms hold about twice the affix rings, with a red banner.
- Without the override, endless seeds 1-10 from floor 1: banners on about one floor in five, none on boss floors, none
  two in a row.
- Reduced motion (cut, no pulse), touch layout (chip in the strip), co-op (same banner on every client, no hold with a
  live world), Daily (same banners for two accounts).
