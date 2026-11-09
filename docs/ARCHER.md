# The Archer: plan

Split the bow off the knight into a second playable character, the **Archer**. Every run, the player picks a character:
the **Knight** carries only the sword (FIRE: swing combo, ALT: guard), the **Archer** only the bow (FIRE: arrow stream,
ALT: charged shot) and rolls farther. SWAP no longer switches weapons in a Knight or Archer run. Boons, duos and relics
that only work with one weapon are only dealt to the character who carries it: bow items to the Archer, sword items to
the Knight.

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay** (the sim's loadout, one per-player roll trait, the draft pools, the tutorial floor) plus a client
screen, a server field and art. The sim learns no character id: a character is a **loadout** (one weapon set; set 1
empty) and a **traits** record (the roll's dash length), both from the run config like today's loadouts. What a player
may be dealt is derived from the weapons they carry, which are already hashed. M1 (`KALEB_VALE_MVP_PARAMS`, the `game`
world), every golden fixture and every spec built on `DEFAULT_LOADOUT` without traits keep the sword + bow loadout and
the web roll, and replay exactly as before. Endless (solo, co-op, daily, dev) and tutorial replays and scores change.

## Status (2026-11-09)

AR0 audited (below); the rest planned. Eleven owner answers (2026-11-09, below) settle every call but one (after tuning); decisions
ARD1-ARD17 are defaults for review except where they cite an answer. Tasks AR0-AR14.

## Owner answers (2026-11-09)

1. **Both ways.** Bow-only items are Archer-only and sword-only items are Knight-only (one weapon tag, no dead cards).
2. **A picker screen every run.** Starting a run from the menu opens a character screen first.
3. **Tutorial: Knight only.** The bow lesson goes; the Archer is learned in play.
4. **Boards shared, character shown.** One leaderboard, daily board and records doc as today; each entry shows its
   character.
5. **Remove the bow lesson's room** (tutorial combat E) from the floor, not just its lesson.
6. **The Archer has a larger dodge.** A longer roll and more i-frames (answer 9).
7. **Archer art:** SmallScaleInt's "2D HD Character pack 1 V1.2", folder `2Archer` (the knight's pack, paid edition).
   Measured below ("Archer art").
8. **Again keeps the same character** (one-press retry); the run-over screen's Character button changes it.
9. **The dodge numbers:** the dash 140 % (2.5 -> 3.38 tiles) **and** more i-frames: 125 % (12 -> 15 ticks).
10. **The Archer's licence:** the paid edition (all 9 characters, with-shadows and shadowless sheets, individual
    sprites) under SmallScaleInt's Standard Commercial License: use in unlimited commercial or personal game projects;
    no attribution or credit required; modify, recolor and re-export freely for your own project; cannot resell,
    redistribute or sublicense the raw asset files themselves; not for use on stock-asset or asset-pack resale
    platforms. The store asks for a rating and review.
11. **Names:** "Knight" and "Archer". The screen's summary lines and the per-character overrides below are the working
    text.

## AR0 findings (2026-11-09, on `cc22c8f`)

Read on the branch's base. The tables above are corrected in place where the code disagreed (marked "AR0").

**Weapon set 1, `DEFAULT_LOADOUT`, SWAP and `weaponSwapped`.**
- Sim: `DEFAULT_LOADOUT` is the fallback in `createCombatState` (`config.loadout ?? DEFAULT_LOADOUT`, combat.ts 212)
  and `createPartyState` (party.ts 90). SWAP is read only in `stepWeapons` (weapons.ts 107: flips whenever
  `sets.size() > 1`, i.e. always). `weaponSwapped` is read by the sword (swap-in resets combo and guard, sword.ts 235),
  the bow (cancels a charge, bow.ts 248), the co-op weapons phase (combat.ts 595-605, per player then OR-ed), the audio
  cue (`sfx.player.swap`, view/audio/cues.ts 685) and telemetry (`weaponSwaps`, run/telemetry.ts 271). Builds:
  `buildsOnSwap` (a swap ends a guard and its brace count).
- View: `WeaponPanel` draws both sets (client/ui/hud/WeaponPanel.tsx 124); `view/watch.ts` `swapEdge` (an
  `activeSet` change); sprites.ts / fxCues.ts / WeaponViewController read the set in hand only; the touch Swap button
  (`play/touch/controls.ts` 29) and the binding `swap` (`play/bindings.ts` 110); the snapshot's `activeSet`.
- Tutorial: the director's `bowInHand` / `heavyTick` (director.ts 401-411, the `bow` / `heavyArrow` skills); the bot's
  `wield` (presses SWAP up to 4 times) and its combat E branch (tutorialBot.ts 640-660, 823); `run/tutorial.spec`'s
  sweep-lock scenario swaps to the bow.
- Harnesses / specs: `enemies.determinism.spec` presses SWAP at random (its one-weapon walkers already carry the weapon
  in both sets), `variantTtk` (`[weapon, undefined]`), `buildTune` / `legendaryTune` (their bots swap or hold one
  weapon), `weapons.spec` / `combat.determinism.spec` / `swordBow.determinism.spec` / `goldenCensus.spec`
  (`DEFAULT_LOADOUT`), many builds specs arm `loadout: ["weapon.bow"]` on the floor world (one set: SWAP lands on an
  empty hand today).
- **The endless loadout is read from floor 1's world**, not the run config: `createSimState` passes `world.loadout` to
  `createCombatState` / `createPartyState` (state.ts 389-394), so an endless `SimConfig.loadout` is ignored today. No
  endless config sets one, and the specs set it on their floor worlds. AR3 makes the run config's win
  (`config.loadout ?? world.loadout`; identical for every non-endless config, where config is the world).
- `stepPlayer` receives the floor's world config (`simWorldConfig`, step.ts 287 / 383): traits must be read from the
  run config and handed to it (AR3).

**`ROLL_DASH_STEP` / `ROLL_DISTANCE`.** Only the sim reads them: `stepPlayer`'s one line (player.ts 212) and Wrecker's
roll smash (the same `dist`); `ROLL_DISTANCE` only in player.spec, `ROLL_DASH_STEP`'s hex in constants.spec. The view
reads `ROLL_TICKS` (the roll animation `stretched` over 21 ticks, sprites.ts 390) and `rollTicks` edges (dust,
afterimages, squash, the audio watch): nothing assumes 2.5 tiles. Bots roll on timers (`TUNE_POOL_ROLL_TICKS`) or into
volleys (`legendaryTune` `DEFENSE_ROLL_*`); none measures the roll's length.

**Where a run config is rebuilt from world + seed + party.** Client: `SimController.makeRun` (solo, daily, dev, the
tutorial, R and Again restarts all go through it: `buildWorldSetup(world, seed, { atBossDoor, dev })`) and
`startCoop` (`partyRunStarted`: `buildWorldSetup(kind, seed, { atBossDoor: false, partySize })`): two call sites, not
three. Server: `RunSessionRegistry.start` (runSessions.ts 253, the session's setup that segments validate against)
and the legacy `validateRun` (validate.ts 239: `buildRunConfig(seed, { world: limits.world })`, `LIVE_RUN_LIMITS`
world "endless", RunValidationService). Tools: `run/testing` bots (`endlessBot`, `partyBot`, `pactsBot`, `vaultRun`,
`buildTune`, `tutorialBot`) and the censuses call `buildEndlessRunConfig` / `buildTutorialRunConfig` directly; the
replay specs rebuild with the same functions. AR4 keeps `buildEndlessRunConfig` without characters exactly as today
(both weapons), so every tool, census and `endlessSpawn.spec`'s `validateRun(LIVE_RUN_LIMITS)` round trip are
unchanged; only the world registry's builders (`buildWorldSetup`) apply characters.

**Who gets what, against the code.** The table holds, with three corrections in what an item reads (the character
column is unchanged): Skewer reads Overkill's streak line (onKill.ts 245), not arrows, and is the Archer's only
because Piercing Arrows is; Rebuke also fires on roll braces (`rebukeRolls`, riposte.ts 268), the Knight's only
because Riposte is; Full Heart's beam deals the sword's `finisherDamage` read through the weapon registry
(`FULL_HEART_WEAPON_ID`), so the Archer's charged-arrow beam works without the sword in the loadout. Confirmed: Swift
Strikes scales every weapon's cooldown (`attackTicks` in weapons.ts 126) and the sword's recoveries (sword.ts 205 /
222); Piercing Arrows is `bowPierce` (bow.ts 168); Mirror Cloak is read only by the sword's guard (sword.ts 278);
Ballista only by the bow's charge and heavy arrow; Riposte, Thunder Guard and Stillwater only by the guard
(riposte.ts); Ember Wake fires from the slot in hand (weapons.ts 103); Wrecker's roll smash and piece breaks, Bastion's
roll brace, Citadel and Stone Heart read any brace; Storm Blade both the finisher (duos.ts 205) and the 5th arrow hit
(duos.ts 227). Pools: Knight 18 / 11 classic / 16 duos / 4 relics, Archer 19 / 12 / 17 / 3 (AR1's spec counts them).

**Empty pools.** A pedestal nobody can take stays inert and is not drawn (`pedestalOffered`); the vault's Rare share
with no relic left gives `relicFallbackBoosts` (2) boost draws (stepTreasure.ts 206); Greed with an empty pool is
dimmed `PactDim.NO_LEGENDARY` (stepPacts.ts 138). All three read the masked pools after AR2, unchanged.

**Slippery with the Archer's i-frames.** `combinedPercent(Slippery, 125)` is 187.5 / 218.75 / 250, not an integer
(Warbanner's Swift aura, 168.75, is the precedent); `scaleTicks` stays exact (12 x 187.5 + 50 = 2300, etc.):
23 / 26 / 30 ticks as planned.

**Combat E's users.** `placement: "cover"` / `coverTiles` (tutorial.ts 218 / 494, tutorialLayout.ts 100) only combat
E; the `weapons` highlight only the `bow` step (steps.ts 226 -> GameHud's WeaponPanel); prompts
`tutorial.prompt.bow.*` (placeholder manifest); the director's bow reads; the bot's combat E branch; specs
`run/tutorial.spec` "lesson E", the sweep lock's arrows, `tutorial/tutorial.spec`'s step lists and the pinned metrics
row `[9, 5.3, 2]`.

**The remembered pick (ARD12).** The settings document (v2, overrides-only groups `juice` / `controls` / `audio` /
`display`, shared/settings doc.ts): `display` (`DisplayOverrides`, its keys in `DISPLAY_SETTING_KEYS`) takes a
`character` key (only a non-default pick stored), so the document stays v2 like every display key before it.

## What the code gives us (read on `main` @ `d007b503`)

Paths under `src/shared/` unless noted.

| Fact | Where | Consequence |
|---|---|---|
| A player carries `WEAPON_SETS` (2) sets; `DEFAULT_LOADOUT` = `["weapon.sword", "weapon.bow"]`; `SimConfig.loadout` overrides it for player 0 and `PartyConfig.loadouts[i]` per co-op player; an empty set is `undefined` -> `NO_WEAPON` | `sim/combat/weapons/loadout.ts`, `weapons.ts` `createWeaponsState`, `sim/party.ts` 40-90 | Per-player loadouts already exist in the sim. A character's weapons need no new sim config |
| The weapon sets (weapon index, cooldown, scratch) are hashed per player (`writeWeaponsHash`, party weapons in the party group) | `weapons.ts`, `party.ts` | A loadout change moves the state hash but needs no new hashed field; eligibility can be read from hashed state |
| SWAP flips `activeSet` whenever `sets.size() > 1`, which is always true (2 sets, even empty): a `[sword, undefined]` player can swap to an empty hand | `weapons.ts` `stepWeapons` | AR2: a swap onto an empty set does nothing (no event, no `buildsOnSwap`). Unchanged for every two-weapon loadout |
| The roll: `ROLL_TICKS` 21 (0.35 s), i-frames `ROLL_IFRAME_TICKS` 12 (Slippery scales them), a dash of `ROLL_DASH_TICKS` 12 at `ROLL_SPEED` 11 then 9 ticks at `ROLL_RECOVERY_SPEED` 2: `ROLL_DISTANCE` 2.5 tiles. The dash step `ROLL_DASH_STEP` (0.1833) is one constant read in `stepPlayer`; `movePlayer` splits it into `MAX_MOVE_STEP` (0.1) sub-steps; Wrecker's roll smash sweeps the same step | `sim/playerData.ts` 63-80, `sim/player.ts` 178-216 | The Archer's larger dodge is one scaled step at one line and one more percent in `rollIframeTicks` (AR3); the roll's timing, animation and every roll-timed rule stay as they are |
| No live world sets a loadout: `buildRunConfig` / `buildEndlessRunConfig` take seed + party size (+ dev options) | `run/config.ts`, `run/endless.ts`, `run/worlds.ts` | The character has to reach `buildWorldSetup` on the client (2 call sites in `SimController`: `makeRun` for solo / daily / dev / tutorial / R / Again, `startCoop` for `partyRunStarted`; AR0) and the server (`runSessions.ts` 253; the legacy `validateRun` builds with `buildRunConfig` and `LIVE_RUN_LIMITS`) |
| An endless config's own `SimConfig.loadout` is never read: `createSimState` builds the weapons (and `createPartyState` the run loadout) from floor 1's world config, and `stepPlayer` gets `simWorldConfig` (the floor's) (AR0) | `sim/state.ts` 389-394, `sim/step.ts` 287 / 383 | AR3 / AR4: the run config's `loadout` wins over the world's (`config.loadout ?? world.loadout`, identical where config is the world); traits are read from the run config, never the floor's |
| `StartRunRequest.classId` ("the owner's class id, stored with leaderboard entries, display only", max `MAX_CLASS_ID_CHARS`) is accepted and stored on the session and leaderboard posting; **no client sends it** | `run/runSessions.ts` 45 / 80 / 183 / 273, `server/services/RunSessionService.ts` 333, `leaderboard/posting.ts` 32 | Becomes the validated character id (AR5); the board field already exists (owner answer 4) |
| The theme already reserves five classes, `CLASS_IDS` = vanguard, ranger, pyromancer, tinkerer, hexblade (web contract): every pack fills `class.<id>` (asset, colour role, `.name`); vale draws `class.vanguard` with the SmallScaleInt knight (free edition, grid sheets in `art/vendor/smallscale-knight/`); `class.ranger` is a placeholder capsule (`#7fae6a`, "Ranger") | `theme/contract.ts` 475, `theme/packs/placeholder/manifest.ts`, `theme/packs/vale/layout.ts`, `art/atlases.json` | The Knight is `class.vanguard`, the Archer `class.ranger` (ARD1): no contract change, only the `.name` strings |
| The view draws every player as one visual, `ACTOR_VIEW.playerVisualId` = `class.vanguard` | `view/config.ts` 104, `client/controllers/render/ActorRenderController.ts` 648 | AR9: the visual per player from their character |
| The minimap's teammate dots use the `class.*` roles by player index ("the party has no per-player class") | `view/minimap/config.ts` 75-85 | Kept by index (ARD13): two Archers must still tell apart |
| Draft pools: `drawCardOffers` (builds) builds `fresh` / `upgrades` from every boon and the duo pool from `duoAvailable`; `drawBoonOffers` (no builds: the tutorial) from the 12 classic boons; `legendaryPool` / `drawLegendaryOffers` (Greed); `classicLegendaryPool` (Greed without builds); a boss floor's first deal guarantees a duo | `sim/builds/cards.ts`, `sim/progression/progression.ts` 211-290, `sim/pacts/stepPacts.ts` 101 | One eligibility mask applied where each pool is built. With both weapons every item is eligible, so every draw is the same rng draw for draw (AR2's key spec) |
| Relics: `unownedRelics(state, i)` feeds the pedestal offer (`pedestalOffered`) and the vault's Rare reward (`stepTreasure` 206) | `progression.ts` 430-455, `sim/treasure/stepTreasure.ts` | Mirror Cloak (the guard's reflection) is filtered there |
| Duos are offered only once both boons are owned (`duoAvailable`) | `cards.ts` 65 | A duo is eligible exactly when both its boons are: no tag of its own needed (ARD4) |
| Citadel and Stone Heart act on every brace, guard or roll (`builds/hooks.ts` 234-) | `hooks.ts` | They work for the Archer (roll braces); only their text names the guard |
| Tutorial floor 1 is a Forge **chain** floor: `TUTORIAL_ROOMS` in tour order (entrance 0, combat A-G 1-7, treasure 8, shrine 9, stairwell / boss 10), one corridor between neighbours, seed `TUTORIAL.floor1.seed` 7574 found by `scripts/find-tutorial-seed.js` for this chain; room ids are read through `planOf(lesson)` constants; `checkTutorialChain` and the lock spec's digests guard it. Combat E (room 5) is the bow lesson: its sniper turret stands behind a pillar (`placement: "cover"`, `coverTiles`, the only cover placement); step `bow` (skills `bow` + `heavyArrow`, highlight `weapons`); funnel `TUTORIAL_FUNNEL_REVISION` 3 | `run/tutorial.ts` 92-330 / 494, `run/tutorialLayout.ts` 100, `config/tutorial.ts` 115, `tutorial/steps.ts` 222-230, `tutorial/director.ts` 268-445, `onboarding/config.ts` 93 | AR6 (owner answers 3 and 5): the room leaves the chain, the floor-1 seed is searched again, ids after D move down one |
| Touch has a Swap button (`touchLayout` `swap`), the weapons panel a timed swap hint (`HUD_HINTS.swapHintSeconds`), the pad hint bar a swap glyph | `play/touch/controls.ts`, `view/hud/touchLayout.ts`, `view/hud/hints.ts`, `client/ui/hud/WeaponPanel.tsx` | Hidden when the player has nothing to swap to (AR9) |
| Lobbies hold members, ready flags and a world; a world change clears every Ready | `lobby/lobbies.ts` | AR5 / AR8: a member's character is set with their Ready |
| Menu screens: `none` / `main` / `lobbies` / `lobby` / `credits` | `view/menu/nav.ts` 12 | The picker is a new screen `character` |
| Tuning harnesses already split by weapon: `builds.ttk.boss.sword` / `.bow`, `variants.ttk.sword` / `.bow`, `buildTune` (`loadout: [weapon]`), `variantTtk` (`[weapon, undefined]`); the wall slide's snag census (`run/snagCensus.spec.ts`) | `sim/*.spec.ts`, `run/testing/` | AR13 reuses them per character; the census runs the Archer's longer roll too |
| `DAILY.ruleset` is 13 | `daily/config.ts` 51 | 13 -> 14 once (ARD11) |

## Who gets what

Read from the rules (the boon / duo files and the descriptions). **K** Knight only, **A** Archer only, **both** both.

| Item | What it reads | Character |
|---|---|---|
| Sharpened (Executioner) | all player damage | both |
| Swift Strikes (Flurry) | sword recovery / bow stream cooldown; Flurry: finisher crescent (sword), stream arrows in threes (bow) | both, own evolution text (ARD5) |
| Piercing Arrows (Ricochet) | bow arrows | **A** |
| Ember Wake | roll ring | both |
| Hearty, Slippery, Deep Flask, Warding, Lingering, Daredevil, Bounty, Composure | hearts, rolls, flasks, armor, combo, grazes, points | both |
| Chain Spark, Volatile, Soul Shards, Overkill | kills | both |
| Bastion | +1 pip (both), full-ring guard (sword), roll brace (both) | both, own text for the Archer |
| Riposte (Counterstrike) | the guard | **K** |
| Ballista (Siege Bolt) | the heavy arrow, the charge | **A** |
| Wrecker (Demolition) | roll smash, every piece the owner breaks | both |
| Fire Arrows (Ember Wake + Piercing Arrows), Conductor (Chain Spark + Piercing Arrows), Dragon Bolt (Ballista + Ember Wake) | arrows | **A** (derived) |
| Skewer (Overkill + Piercing Arrows) | Overkill's streak line (weapon-free; AR0) | **A** (derived from Piercing Arrows) |
| Thunder Guard, Stillwater (each with Riposte) | the guard | **K** (derived) |
| Rebuke (Bastion + Riposte) | guard braces and roll braces (`rebukeRolls`; AR0) | **K** (derived from Riposte) |
| Storm Blade (finishers and every 5th arrow hit), Full Heart (finishers and charged arrows), Citadel (every brace) | both weapons / any brace | both, own text |
| Blazing Trail, Shrapnel, Chain Reaction, Close Call, Gold Rush, Unshaken, Supernova, Stone Heart, Powder Keg, Happy Hour | weapon-free | both |
| Mirror Cloak (relic) | the guard's erases | **K** |
| Hourglass, Vampire Fang, Second Wind; every curse | weapon-free | both |

Pools: Knight 18 of 20 boons (11 of 12 classic), 16 of 20 duos, 4 relics. Archer 19 of 20 boons (12 of 12 classic), 17
of 20 duos, 3 relics. Both keep all four legendaries (Ember Wake, Composure, Overkill, Bastion).

## Player experience

1. **Play solo.** The character screen: two cards side by side, the Knight and the Archer, each with its idle
   animation, its name and two lines ("Sword: a three-hit combo. Guard blocks bullets." / "Bow: a stream of arrows,
   hold to charge. A longer, safer roll."). The last pick is focused; one press starts the run.
2. **The Archer's run.** Arrows from range, a charged shot through a line of swarmers; no guard, but the roll carries
   a third farther with a little more invulnerability, so a volley is answered by getting out of it. The first draft can deal Piercing Arrows; it never
   deals Riposte.
3. **The Knight's run.** The sword and the guard, as today without the bow. Ballista and Piercing Arrows never show up;
   Riposte and Mirror Cloak do.
4. **A lobby.** Pressing Ready opens the same screen; your pick shows on your member row (a small Knight / Archer
   icon). Two Archers and a Knight is fine.
5. **The board.** Each entry shows a small icon of the character it was played with.
6. **The tutorial.** The Knight only, one room shorter: sword, hits, roll, guard, Ember, map, pellets, then the relic,
   the curse and the boss. The outro's Start my first run opens the character screen.

## Design

### Characters (`shared/characters`, new; pure, Roblox-API-free)

```
CharacterId = "knight" | "archer"
CHARACTERS = [
  { id: "knight", visualId: "class.vanguard", loadout: ["weapon.sword"], traits: NEUTRAL_TRAITS },
  { id: "archer", visualId: "class.ranger",   loadout: ["weapon.bow"],
    traits: { rollDashPercent: ARCHER_ROLL_DASH_PERCENT, rollIframePercent: ARCHER_ROLL_IFRAME_PERCENT } },
]
DEFAULT_CHARACTER = "knight"
isCharacterId(x), characterDef(id), characterLoadout(id), characterTraits(id), characterOfWeapons(weapons) (knight /
archer / undefined for any other loadout: M1's two weapons, test loadouts)
```

Append only (a future Pyromancer etc. takes the next entry and the next `CLASS_IDS` slot). The sim never imports it:
run configs turn characters into loadouts and traits (AR4); the view and the server read it.

### Eligibility (sim, `sim/progression`)

- `BoonDef.requires?: string` (a weapon id) on Piercing Arrows and Ballista (`weapon.bow`) and Riposte
  (`weapon.sword`); `RelicDef.requires` on Mirror Cloak (`weapon.sword`). Duos carry no tag: a duo is eligible when
  both its boons are, which `duoAvailable` already implies (owned boons were eligible when dealt).
- `carriesWeapon(weapons, id)`: any set holds it. `boonEligible(state, i, b)` / `relicEligible(state, i, r)` read
  player i's weapons (`weaponsAt`). `eligibleBoonMask(state, i, out)` fills a reused per-boon boolean array.
- Filters at pool construction only, never after a draw: `drawCardOffers(..., eligible?)` (the `fresh` and `upgrades`
  lists skip ineligible boons), `drawBoonOffers(rng, owned, floorCleared, eligible?)`, `legendaryPool` /
  `drawLegendaryOffers(..., eligible?)`, `classicLegendaryPool`, `unownedRelics` (so pedestals and the vault's Rare
  reward). Absent mask = everything, so the pure functions stay callable as today.
- A player carrying both weapons (M1, `DEFAULT_LOADOUT`, every spec) gets an all-true mask: the same lists, the same
  `rngInt` ranges, the same draws.
- No new hashed field: the mask is a pure function of hashed weapon state.

### The loadout (sim, `weapons.ts`)

A SWAP press switches only when the other set holds a weapon (`sets[next].weapon !== NO_WEAPON`). Otherwise nothing
happens: no `weaponSwapped`, no `buildsOnSwap`, no swap sound. `prevButtons` still updates. Every two-weapon loadout
behaves exactly as before.

### The Archer's dodge (sim, owner answers 6 and 9)

- `PlayerTraits { rollDashPercent, rollIframePercent }` (`sim/playerData.ts` beside the roll; `NEUTRAL_TRAITS` both
  100), read through
  `playerTraits(config, i)`: `SimConfig.traits` for player 0 and `PartyConfig.traits[i]` per co-op player, exactly like
  `loadout` / `loadouts`; absent = neutral.
- **Distance:** `ARCHER_ROLL_DASH_PERCENT` **140** (`shared/characters`, owner answer 9). `stepPlayer`'s dash step is
  `scalePercent(ROLL_DASH_STEP, rollDashPercent)` (exactly `ROLL_DASH_STEP` at 100): 0.1833 -> 0.2567 a tick, so the
  roll goes 2.5 -> **3.38 tiles**. The roll's 21 ticks, the 12-tick dash phase, the recovery and the roll animation are
  unchanged. `movePlayer` splits the longer dash tick into 3 sub-steps of `MAX_MOVE_STEP` instead of 2, so collision
  and the wall slide work as for any move.
- **I-frames:** `ARCHER_ROLL_IFRAME_PERCENT` **125** (owner answer 9): `rollIframeTicks` scales `ROLL_IFRAME_TICKS` by
  `combinedPercent(Slippery's percent, rollIframePercent)`, one rounding (`scaleTicks`), exactly today's at 100: the
  Archer gets 15 ticks (0.25 s) instead of 12, so the last 3 cover the start of the recovery; with Slippery I / II /
  III 23 / 26 / 30 ticks (Knight 18 / 21 / 24; III already outlasts the 21-tick roll today). Phantom Step and Bastion's
  roll brace read the roll itself, not the i-frames, so only the hits avoided change.
- Not hashed (config, like the loadout's source): the client and the server build it from the same characters, and a
  mismatch would show in the hashed positions on the first roll.
- Rules that ride the roll follow the longer path with no change of their own: Wrecker's roll smash sweeps the longer
  step; Blazing Trail's 6 embers (ticks 3..18) land farther apart; Phantom Step and Bastion's roll brace see the
  bullets of a longer path (likelier braces: AR13 measures); Ember Wake's ring is fired at the start as today.
- View: nothing to change (the afterimages, dust and the roll's `stretched` animation follow the positions and ticks).

### Run configs (`shared/run`)

`WorldBuildOptions.characters?: ReadonlyArray<CharacterId>` (per player, index order; absent: each world's default).

| World | Loadout and traits |
|---|---|
| `endless`, `daily`, `dev` | from `characters` (solo: `SimConfig.loadout` / `traits`; co-op: `party.loadouts` / `traits`); missing entries `DEFAULT_CHARACTER`'s |
| `tutorial` | the Knight's (owner answer 3), whatever is passed |
| `game` (M1), `dungeonNoEncounter`, `greybox` | `DEFAULT_LOADOUT` (both weapons), no traits, as today; `characters` ignored (ARD9) |
| `dev` with the dev panel's "Both weapons" | `DEFAULT_LOADOUT` with the picked character's traits (testing; dev runs are never submitted) |

`RunSetup.characters` echoes what the run was built with, for the view.

### Text per character (theme / view)

Optional string overrides `<key>.<characterId>`: the reader asks for `boon.bastion.desc.archer` first, then
`boon.bastion.desc`. Shipped for the mixed items whose English names the other weapon:

| Key | Knight | Archer |
|---|---|---|
| `boon.swiftStrikes.evo.desc` | 40% faster; finishers release a crescent of bolts | 40% faster; arrows fly in threes |
| `boon.bastion.desc` | (unchanged) | +1 armor pip; roll through 8 bullets: +1 pip |
| `duo.stormBlade.desc` | Finishers spark | Every 5th arrow hit sparks |
| `duo.fullHeart.desc` | At full hearts, finishers fire a beam | At full hearts, charged arrows fire a beam |
| `duo.citadel.desc` | (unchanged) | Every roll through 8 bullets restores a pip |

The wording is a placeholder for the owner. The draft, the item tooltips (docs/ITEM_TOOLTIPS.md), the build lists and the
codex read the local player's character.

### The character screen (client; owner answer 2)

`MenuScreen` `character` (nav.ts). Opened by every run start from the menu: Play solo, Daily, the tutorial outro's
Start my first run, the dev panel's start, and a lobby member's Ready. Two cards (horizontal; a column in portrait,
docs/PORTRAIT.md), each: the idle sprite (or the placeholder capsule), the name (`class.<id>.name`), two summary lines.
The last pick is focused (stored, ARD12). Confirm starts the run that opened it (or readies the lobby member); Back
returns to the screen that opened it. Pad: its own focus scope (docs/GAMEPAD_MENUS.md), left / right, A confirm, B back,
hint bar. Touch: tap a card, then Start. Keyboard: arrows / A-D, Enter / Space. No timer.

**Again on the run-over screen** keeps the run's character and starts at once (docs/RUN_RECAP.md: one-press retry); a
**Character** button beside it opens the screen. Owner answer 8: the retry skips the screen.

### Server and lobbies

- `StartRunRequest.characterId` (replaces `classId`, same size limit): optional, default `DEFAULT_CHARACTER`; an unknown
  id is `bad_request`. Solo: the request's. Co-op: the lobby's member picks, in member order.
- `Lobby.characters` (member -> CharacterId): `setReady(lobbyId, ready, characterId)` stores the pick with the Ready; a
  member who has not readied keeps their last pick, shown as is. A world change clears Ready as today (the pick stays).
- `RunSession.characters` (member order); the validator's setup is `buildWorldSetup(kind, seed, { partySize,
  characters })`, so the server's replay builds exactly the client's loadouts and traits. The party start
  (`partyRunStarted`) carries the list; every client builds the same config.
- Leaderboard posting: `classId` = the owner's character (the field and its doc stay; owner answer 4); party entries
  carry every member's. Records (`KV_Records_v1`) and the daily boards are unchanged (one per board, not per character).
- Telemetry: the run record and `RunRecap` gain the character (one field; checked against the analytics budget,
  `shared/onboarding` `analyticsCatalog`).

### The tutorial floor (owner answers 3 and 5)

- `TUTORIAL_ROOMS` loses combat E: 10 rooms, the entrance, combat A-D (1-4), F (5), G (6), treasure 7, shrine 8,
  stairwell / boss 9. Code reads ids through `planOf` (`TUTORIAL_GUARD_ROOM`, `TUTORIAL_PELLET_ROOM`, ...), so the
  constants follow; CLAUDE.md's "treasure / shrine / stairwell 8-10" note becomes 7-9.
- The chain changed, so 7574 no longer means the same floor: `scripts/find-tutorial-seed.js` searches again and
  `TUTORIAL.floor1.seed` takes the pick (same theme rules as before); `checkTutorialChain` must pass and the lock spec's
  digests are re-recorded. Floor 2 (seed 905) is untouched.
- The `cover` placement (`coverTiles`, used only by combat E's turret) is removed with its room, unless AR0 finds another
  user.
- Lesson ids keep their names (`combatF`, `combatG`: strings, funnel step ids and the bot's branches unchanged, ARD16).
- The `bow` step, the `bow` / `heavyArrow` skills and the director's bow reads go; the `weapons` highlight is checked
  for other users; `TUTORIAL_FUNNEL_REVISION` 3 -> 4 (`t1r4`), lessons renumbered, event caps recomputed
  (docs/TUTORIAL_FUNNEL.md); the tutorial bot drops its combat E branch; docs/TUTORIAL.md's floor 1 table follows.

### Archer art (owner answer 7)

Measured on the connected `2Archer` folder (3,592 PNGs): per-frame files `<Anim>/<facing>/<Anim>_<angle>_<frame>.png`
(facing folders E / NE / N / NW / W / SW / S / SE, angles 0..315 counter-clockwise from E: the Lords of Pain skeleton's
naming, so the pipeline's per-frame source type reads it), **128 x 128 cells, 8 facings, 15 frames per animation, shadow
baked in**: the knight's format and scale. 30 animations, among them Idle, Run, Rolling, TakeDamage, Die, QuickShot,
AttackRun (shooting on the move), Attack1-3 and Special1-2 (draws and releases; Attack3 a jumping shot).

Proposed mapping (checked by eye in AR12): idle Idle, run Run, roll Rolling, hit TakeDamage, death Die; the stream
QuickShot (AttackRun while walking, if it reads better); the charge the draw half of Attack1 held on its last drawn
frame and the release its second half (segments split at measured marks, the `SPRITE_ANIM_MARKS` pattern of
docs/DEMON_ART.md). Kept frames as the knight's (8 of 15: one 1024 atlas per animation), the 1 px outline sheets with
`clipAtCellEdge`, `pixelsPerTileFrom: "class.vanguard"`. Raw files go to gitignored `art/vendor/smallscale-archer/`.

## Tasks

- **AR0 Audit.** On the branch's base, record as "AR0 findings": every reader of weapon set 1, `DEFAULT_LOADOUT`,
  `weaponSwapped` and SWAP (sim, view, tutorial, bots, harnesses); every reader of `ROLL_DASH_STEP` / `ROLL_DISTANCE`
  (sim and view: anything that assumes 2.5 tiles); every place a run config is rebuilt from world + seed + party
  (client live run, Again, dev restart, server validator, local replay tools, censuses); every effect of every item in
  "Who gets what" against its code (the table holds or is corrected); combat E's users in the tutorial (`coverTiles`,
  the `weapons` highlight, prompts, the bot); where the remembered pick is stored (ARD12). **Verify:** findings
  written; the table confirmed.
- **AR1 Characters and tags.** `shared/characters` (data, helpers, barrel); `BoonDef.requires` / `RelicDef.requires`;
  `carriesWeapon`, `boonEligible`, `relicEligible`, `eligibleBoonMask`. No rule reads them yet. **Verify:** specs:
  every boon / duo / relic's eligibility per character equals the table (the derived duos included); the pool counts
  (18 / 16 / 4 and 19 / 17 / 3); both weapons -> everything eligible; `npm run verify` green, no hash moved.
- **AR2 Sim: swap and pools.** The swap rule; the masks in `drawCardOffers`, `drawBoonOffers`, `legendaryPool` /
  `drawLegendaryOffers`, `classicLegendaryPool`, `unownedRelics`; `openDraft` / `redeal` / Greed / treasure pass the
  player's mask. **Verify:** specs: with `DEFAULT_LOADOUT` every draw over 10,000 seeded deals (builds and classic,
  boss double draft, Greed, relic pedestal, vault Rare) is identical to the unmasked function, rng state included;
  golden fixtures, `roomPool.lock.spec`, the tutorial lock and every determinism spec unchanged; a Knight is never dealt
  Piercing Arrows / Ballista / their duos, an Archer never Riposte / Mirror Cloak / theirs, over 2,000 builds runs each
  (`buildOffers` harness); a `[sword, undefined]` player's SWAP changes nothing (no event, `buildsOnSwap` not called,
  a guard keeps running) and a two-weapon swap is unchanged.
- **AR3 The Archer's dodge.** `PlayerTraits`, `NEUTRAL_TRAITS`, `playerTraits`, `SimConfig.traits` /
  `PartyConfig.traits`, the scaled dash step, the i-frames through `rollIframeTicks`. **Verify:** specs: without traits
  every golden run and `runPlayer*` spec matches; at 140 % an open-floor roll covers 3.38 tiles (to float tolerance of
  the summed sub-steps) in 21 ticks; i-frames 15 ticks at 125 % and 23 / 26 / 30 with Slippery I-III (Knight 12 / 18 /
  21 / 24, unchanged); a bullet meeting the Archer on the 14th roll tick misses, the Knight's is hit; a roll into a wall stops flush and slides (the wall
  slide's corner cases at the longer step); co-op: an Archer and a Knight rolling the same input end 3.38 / 2.5 tiles
  out; Wrecker's smash reaches a crate 3 tiles away; two runs hash the same every tick.
- **AR4 Run configs.** `WorldBuildOptions.characters`, `RunSetup.characters`, the table above; `DAILY.ruleset` 13 ->
  14. **Verify:** specs: endless / daily / dev solo and co-op build each character's loadout and traits per player; M1
  / greybox ignore them (golden runs match); a run replayed from its setup hashes the same every tick for Knight,
  Archer and a mixed party; `daily.spec` ruleset 14; the snag census (WS5) passes with the Archer's roll.
- **AR5 Server and lobbies.** `characterId` on `StartRunRequest` (validated), `Lobby.characters` and `setReady`'s pick,
  `RunSession.characters`, the party start payload, the validator's setup, leaderboard `classId`, telemetry field.
  **Verify:** `runSessions.spec` / `lobbies.spec`: unknown ids refused, the session's setup uses the picks in member
  order, a party run validates with three different picks, a pick change after Ready un-readies; a solo upload built
  as an Archer but sent as a Knight fails validation (loadout and roll differ).
- **AR6 Tutorial, Knight only, one room shorter.** Everything in "The tutorial floor": the Knight's loadout, combat E
  out of `TUTORIAL_ROOMS`, the new floor-1 seed, `cover` gone, the `bow` step and skills gone, funnel revision 4, the
  bot, docs; the outro's Start my first run opens the character screen. **Verify:** `checkTutorialChain` finds no
  problem; `run/tutorial.spec` (new digests and pins); the tutorial bot completes floor 1 and 2; funnel specs
  (`analyticsCatalog` budget); `l10n:check`; Studio item 9.
- **AR7 Character screen.** Pure model in `shared/view/menu` (cards, focus, summary keys; fit specs for the smallest
  phone, portrait, console TV-safe); `CharacterScreen` component, nav screen `character`, MenuController routing for
  every start in "The character screen", Again + the Character button on run over, the remembered pick. **Verify:**
  pure specs (focus order, last pick focused, Back targets, fit); Studio items 1-3.
- **AR8 Lobby UI.** Ready opens the screen; member rows show each pick; the host's Start uses them. **Verify:** Studio
  item 4 (two clients); a lobby start with a mixed party.
- **AR9 In-run view.** Per-player visual; weapon panel, swap hint, touch Swap and pad glyph gated by
  `hasSwapTarget`; character icons on recap, contribution and leaderboard rows. **Verify:** pure specs
  (`hasSwapTarget`, the visual pick, the touch layout with Swap hidden keeps every other button's box); footprint and
  fit specs unchanged; Studio items 5-8.
- **AR10 Per-character text.** The override lookup in the progression strings (draft cards, build lists, tooltips,
  codex) with the local player's character; the five overrides. **Verify:** specs: the Archer's Bastion card reads the
  archer line, the Knight's the base line, an unknown override falls back to English; `l10n:check`.
- **AR11 Theme and strings.** `class.vanguard.name` "Knight", `class.ranger.name` "Archer"; the screen's strings
  (`character.title`, `character.start`, `character.<id>.line.1` / `.2`, `runOver.character`), the overrides, optional
  `ui.character.<id>` icons; `l10n/context.json` entries. **Verify:** theme validator, `l10n:check`, the Luau
  top-level locals of `contract.luau` / `validate.luau` counted on out/ (no top-level constant added).
- **AR12 Archer art.** Copy `2Archer` into `art/vendor/smallscale-archer/`; an `art/atlases.json` set `class.ranger`
  (the per-frame source, the mapping above, rims); `art:build` / `art:lock`; the animation mapping in `shared/view`
  (the bow's stream and charge timers over the chosen clips); a `THIRD_PARTY_NOTICES.md` entry for the paid edition
  with owner answer 10's terms (beside the free edition's Knight entry; no credit required, so the Credits screen only
  if the Knight is listed there too); upload, ids in `assetIds.ts`. Until then the vale Archer is the
  placeholder capsule. **Verify:** `test:art`, vale validates, every knight output byte-identical; Studio item 5.
- **AR13 Tuning.** Per character with the existing harnesses: TTK by room kind (sniper, sprayer / caster turrets,
  summoner, stormcaller, reaper, bomber rooms), pack and boss, with and without builds, floors 1-20; endless bot
  survival by floor (the bot gains a bow mode); the Archer's roll: hits taken per room against the Knight's, Bastion
  brace rate, Blazing Trail / Wrecker reach; offer statistics per pool (evolutions and duos per run by floor 11).
  **Verify:** tables in this doc; recommendations as owner calls, no number changed here.
- **AR14 Studio check, playtest.** The checklist; solo as each, a mixed co-op party, the Daily as each.
  **Verify:** checklist passed; owner playtest notes here.

Studio checklist: 1. every menu start opens the screen with the last pick focused, mouse / pad / touch / portrait;
2. Back from it returns where it came from; 3. Again keeps the character, Character changes it; 4. lobby picks show on
every member's row and the run starts with them; 5. the Archer draws its own sprite and outline, the Knight the knight,
the Archer's roll animation fills its longer roll; 6. no swap hint, touch Swap or pad glyph in a Knight or Archer run,
both still in M1 / dev "Both weapons"; 7. an Archer's drafts, pedestals and vault rewards never show a Knight item and
the reverse; 8. board, recap and contribution rows show the character icon; 9. the tutorial runs start to finish as the
Knight, combat D's corridor leads straight to combat F, no bow prompt.

## Edge cases

- A swap press while rolling or dead: as today (the press edge is read only while alive).
- A Knight's Ember Wake ring is fired with the sword's slot as today (its source is the slot in hand).
- The Archer rolling into a doorway or a pillar: the longer step is sub-stepped like any move, so it stops or slides
  exactly where a walk would.
- Greed's pool for an Archer at the end of a run can run out sooner (one fewer boon); Greed is then not offered, as
  today when the pool is empty.
- The vault's Rare reward with no eligible relic left (an Archer holding the three): the existing empty-pool path (AR0
  confirms what it gives).
- A party member who leaves: their character stays in the session (their slot stays in the sim as today).
- Replays and runs started on an older build have no character: they cannot be validated by a new server (endless
  replays change anyway; ARD11).
- Dev mode's R restart keeps the character (and "Both weapons").

## Decisions (2026-11-09)

- **ARD1** The Knight is `class.vanguard`, the Archer `class.ranger` (slot ids unchanged; names "Knight" / "Archer",
  owner answer 11).
- **ARD2** A character is a loadout plus a traits record; the sim knows weapons and traits, never a character id. One
  weapon set each; set 1 empty.
- **ARD3** A swap onto an empty set does nothing.
- **ARD4** Eligibility is one weapon tag per boon / relic (owner answer 1); duos follow their boons; filtered where the
  pools are built, so a two-weapon player draws exactly as before.
- **ARD5** Mixed items stay for both, with per-character text where the English names the other weapon.
- **ARD6** The character screen opens for every run started from the menu or a lobby Ready (owner answer 2); Again keeps
  the character (owner answer 8).
- **ARD7** The tutorial is the Knight's (owner answer 3) and combat E's room is removed from floor 1 (owner answer 5).
- **ARD8** Boards, daily boards and records are shared; the character is shown (owner answer 4).
- **ARD9** M1 (`game`), `dungeonNoEncounter`, `greybox` and every fixture keep `DEFAULT_LOADOUT` and no traits; dev has
  a "Both weapons" option.
- **ARD10** The roll (dash length and i-frames) is the only per-character stat (owner answers 6 and 9); hearts, speed
  and damage stay shared unless AR13 shows a need (the open owner call).
- **ARD11** `DAILY.ruleset` 13 -> 14 once (AR4); the all-time boards stay `_v1` (BUD9's precedent).
- **ARD12** The remembered pick is a client preference in the settings document (overrides-only, default Knight); AR0
  confirms the group.
- **ARD13** Minimap teammate colours stay by player index.
- **ARD14** Any party mix, duplicates allowed.
- **ARD15** The larger dodge: the dash phase 140 % (2.5 -> 3.38 tiles) and i-frames 125 % (12 -> 15 ticks), folded with
  Slippery into one percent; the roll's time and recovery unchanged (owner answer 9).
- **ARD16** Tutorial lesson ids keep their names after combat E goes (`combatF` / `combatG`), so strings and funnel ids
  do not churn; room ids follow `planOf`.
- **ARD17** The Archer's art is the SmallScaleInt Archer (paid edition, Standard Commercial License), mapped as in
  "Archer art" (owner answers 7 and 10).

## Open owner calls

1. **After AR13:** more per-character stats or tools if one character falls behind (for example the Archer in bullet
   rooms without a guard, the Knight against snipers and turrets without range).

## Risks

- **The game was tuned around the swap.** The Knight has no range for snipers, turrets and the Summoner; the Archer has
  no guard and no bullet-erasing swing, only the roll. Rooms and bosses tuned for a player with both may be unfair for
  one. AR13 measures before release.
- **The longer roll and the roll builds.** Bastion's roll brace, Phantom Step and Wrecker see a third more path per
  roll, and 3 more i-frames forgive late rolls, so the Archer's roll builds are stronger than the Knight's. AR13's
  brace rate and hits-per-room show how much.
- **Co-op lockstep.** Every client and the server must build identical loadouts and traits; a mismatch desyncs on the
  first roll or tick 0. AR5's validation spec and the party start payload carry the picks.
- **Pool sizes.** Smaller pools make evolutions and duos a little more frequent (BU13 / LG7 tuned 20 boons); AR13's
  offer table shows it.
- **Retry friction.** A screen before every menu start adds a press; Again stays one press by default.
- **Tutorial analytics.** Revision 4 starts a new funnel; older numbers are not comparable step for step. A new floor-1
  seed can move the floor's look (theme, decoration); the seed search keeps the chain's rules.
- **Art gates the release.** A placeholder capsule beside the knight sprite reads unfinished; ship the character with
  AR12 done.

## Out of scope

- The other reserved classes (Pyromancer, Tinkerer, Hexblade) and character unlocks or progression.
- Other per-character stats, skills or a second weapon per character.
- Per-character boards, records or daily boards (owner answer 4).
- New Archer-only or Knight-only boons to even the pools.

## AR1 (as built)

Data and helpers only: no rule reads them yet, so every run plays, draws and hashes exactly as before. Paths under
`src/shared/`. The names below are final; later tasks use them as is.

- **Weapon ids** (`sim/combat/weapons/loadout.ts`, exported from shared/sim): `SWORD_WEAPON_ID` "weapon.sword",
  `BOW_WEAPON_ID` "weapon.bow"; `DEFAULT_LOADOUT` is now `[SWORD_WEAPON_ID, BOW_WEAPON_ID]` (same values).
- **Tags** (`sim/progression/progressionData.ts`): `BoonDef.requires?: string` (a weapon id) on Piercing Arrows and
  Ballista (`BOW_WEAPON_ID`) and Riposte (`SWORD_WEAPON_ID`); `RelicDef.requires?: string` on Mirror Cloak
  (`SWORD_WEAPON_ID`). Duos carry none.
- **Eligibility** (`sim/progression/eligibility.ts`, in the progression barrel): `carriesWeapon(weapons, id)` (any set
  holds it), `boonEligible(state, i, boon)` / `relicEligible(state, i, relic)` (player i's `weaponsAt`; false for an
  index that is no boon / relic), `eligibleBoonMask(state, i, out)` (fills entries 0 .. BOON_COUNT - 1 of a caller's
  reused array and returns it), and two mask readers the pools use in AR2: `maskAllows(eligible, boon)` (no mask:
  true) and `duoEligible(eligible, duo)` (both its boons allowed). No state, nothing hashed.
- **Traits data** (`sim/playerData.ts`; moved forward from AR3 because the characters carry them): `PlayerTraits {
  rollDashPercent, rollIframePercent }`, `NEUTRAL_TRAIT_PERCENT` 100 (progression's `PERCENT`, which playerData cannot
  import), `NEUTRAL_TRAITS` (both 100, frozen). Nothing reads them until AR3.
- **Characters** (`characters/`, new, pure; barrel `shared/characters`): `CharacterId` "knight" | "archer",
  `CharacterDef { id, visualId, loadout, traits }`, `CHARACTERS` (append only: Knight `class.vanguard`
  `[SWORD_WEAPON_ID]` `NEUTRAL_TRAITS`; Archer `class.ranger` `[BOW_WEAPON_ID]` { 140, 125 }), `CHARACTER_IDS`,
  `DEFAULT_CHARACTER` "knight", `ARCHER_ROLL_DASH_PERCENT` 140, `ARCHER_ROLL_IFRAME_PERCENT` 125, `isCharacterId(x)`,
  `characterDef(id)` (throws on an unknown id), `characterLoadout(id)`, `characterTraits(id)`,
  `characterOfLoadout(loadout)` (set for set over `WEAPON_SETS`, an empty set undefined or "") and
  `characterOfWeapons(weapons)` (a `WeaponsState`, through the registry ids): the character, or undefined for any
  other loadout (M1's two weapons, test loadouts). It imports shared/sim; the sim never imports it.
- **Spec** `characters/characters.spec.ts` (11): the table and helpers; the tags; per character every boon, duo
  (derived) and relic against "Who gets what"; pool counts Knight 18 / 11 / 16 / 4, Archer 19 / 12 / 17 / 3; both
  weapons (no loadout, `DEFAULT_LOADOUT`, either order) everything; co-op per player (`PartyConfig.loadouts`); out of
  range.
- **Ran:** typecheck, lint, build; `shared/characters` 11 / 11, `sim/progression` 52 / 52, `sim/hash` 6 / 6,
  `sim/constants` 7 / 7 (no hash moved: nothing reads the new data).
