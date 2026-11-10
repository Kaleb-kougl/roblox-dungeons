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

**AR0-AR13 built** on branch `archer` (2026-11-09; each task's "(as built)" section below, in build order). Open:
**AR14** (Studio check and playtest, the checklists in AR7 / AR8 / AR9 and "Tasks") and the owner calls AR13 raises
(below, "Open owner calls"). The 14 Archer PNGs were uploaded 2026-11-09 and their IDs are in `assetIds.ts`, so the
bundled vale pack draws the Archer (AR12). Eleven owner answers (2026-11-09, below); decisions ARD1-ARD17 are defaults for
review except where they cite an answer.

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
12. **Health (2026-11-09, after AR13):** the Archer starts with one heart less than the Knight: 2 hearts (4 half
    hearts) to the Knight's 3 (answer: one full heart, not a half). See "The Archer's health".

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

### The Archer's health (sim, owner answer 12)

- `PlayerTraits.heartsMaxDelta` (half hearts added to `START_HALF_HEARTS`; `NEUTRAL_TRAITS` 0, `NEUTRAL_TRAIT_DELTA`):
  `ARCHER_HEARTS_MAX_DELTA` **-2** (`shared/characters`), so the Archer's starting and maximum health is 4 half hearts
  (2 hearts), the Knight's 6 as before. `playerStartHalfHearts(traits)` (`sim/playerData.ts`, at least
  `MIN_START_HALF_HEARTS` 1) is applied once, in `createSimState` right after the party is built, to every player
  (`playerTraits(config, i)`, like the roll); the tutorial's wounded start then clamps to that maximum.
- Everything that refills or caps health reads `heartsMax` (respawn, revive, flask, Hearty, Lionheart, Stone Heart,
  Full Heart), so the Archer's maximum holds all run and Hearty still adds to it.
- `heartsMax` is hashed state, so Archer runs replay and hash differently from older builds; a run without traits or
  with the Knight's hashes exactly as before (no fixture, M1, tutorial or Knight run changes).
- `runStartHalfHearts(config, playerIndex = 0)` reads the player's traits, so RunTelemetry's baseline is the Archer's 4.
- Text: `character.archer.line.2` "A longer, safer roll; one heart less." (the HUD draws `heartsMax / 2` hearts, no
  view change). Spec `characters/archerHearts.spec.ts`.

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
- **ARD10** The roll (dash length and i-frames) and, since owner answer 12, health (the Archer one heart less) are the
  per-character stats (owner answers 6, 9 and 12); speed and damage stay shared unless AR13 shows a need.
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

1. **After AR13** (tables and options in "AR13 (as built): tuning"):
   - **Archer clear speed:** the bow-only bot clears mixed rooms 1.9-2.5x slower than the old two-weapon player from
     floor 6 (bosses 1.13-1.32x) but takes far fewer hits and survives deepest. Options: accept, a faster stream
     (`streamTicks` 12 -> 10, also M1's bow), an Archer damage trait, or teach the charged shot. AR13 suggests accept +
     teach, then judge in the AR14 playtest.
   - **Knight in ranged rooms:** 5-36 % slower against snipers, imps, summoners and stormcallers (worse on floor 2).
     AR13 suggests accept.
   - **Archer + Slippery:** 125 % x Slippery I = 23 i-frame ticks, longer than the 21-tick roll: a rolling Archer
     cannot be hit. Options: cap `rollIframeTicks` at 20 for everyone, take the larger of the two percents instead of
     their product (18 / 21 / 24 like the Knight), or accept. AR13 suggests the larger percent, or the cap.
   - **Melee survival** could not be measured (the bot cannot read boss telegraphs): check the Knight's first boss in
     AR14 before any Knight change.

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

## AR2 (as built)

The swap rule and the masks. A player carrying both weapons draws exactly as before (rng state included): every
golden fixture, `roomPool.lock`, the tutorial lock and every determinism spec pass unchanged; only a one-weapon
loadout (no live world builds one until AR4; some specs arm `[bow]` on their floor worlds) behaves differently.

- **Swap** (`sim/combat/weapons/weapons.ts` `stepWeapons` step 3): the press edge switches only when the next set holds
  a weapon (`sets[target].weapon !== NO_WEAPON`); otherwise nothing: no `weaponSwapped`, no `buildsOnSwap`, the set in
  hand stays and its step runs as if no swap was pressed (a guard keeps counting down); `prevButtons` still updates. An
  empty set 0 with a weapon in set 1 still swaps to it (only an empty target is refused).
- **Masks** (optional trailing `eligible?: ReadonlyArray<boolean>`, absent = every boon; `maskAllows` / `duoEligible`
  from AR1):
  - `sim/builds/cards.ts`: `drawCardOffers(rng, rules, levels, duos, floorCleared, guaranteeDuo, eligible?)` (the new
    and upgrade pools skip boons the mask leaves out, the duo pool skips duos with such a boon: owned boons are not
    assumed eligible, so a hand-built state cannot leak one); `legendaryPool(levels, duos, eligible?)`;
    `drawLegendaryOffers(rng, levels, duos, count, eligible?)` (its pool and its fill). New
    `playerBoonMask(state, i)`: `eligibleBoonMask` into one module scratch array (read before asking again);
    `drawPlayerCardOffers` passes it, so `openDraft` and `redeal` (the boss double draft's second deal) are masked.
  - `sim/progression/progression.ts`: `drawBoonOffers(rng, owned, floorCleared, eligible?)` (`openDraft` without builds
    passes `playerBoonMask`); `unownedRelics(state, i)` filters by `relicEligible`, and the pedestal (stepRun step 4)
    now draws through `unownedRelics` (it had its own unfiltered list), so the pedestal, `pedestalOffered` and the
    vault's Rare share (`stepTreasure` `grantRelicShare`) all read the masked pool.
  - `sim/pacts/stepPacts.ts`: `classicLegendaryPool` filters by `boonEligible`; `greedPool` (Greed's dim) and
    `takeGreed`'s deal pass `playerBoonMask`.
- **Harness** (`run/testing/buildOffers.ts`): `simulateOffers(policy, runs, checkpoints, rules?, eligible?)` passes the
  mask to every draw; `OfferCheckpoint.boonDealt` / `duoDealt` count every card dealt per boon / duo (any kind, drafts
  and Greed).
- **Specs:** `sim/progression/eligibility.spec.ts` (9): both weapons vs unmasked over 10,000 seeded random builds each
  for `drawCardOffers` (the guaranteed duo in a quarter of them), `drawBoonOffers`, `legendaryPool` +
  `drawLegendaryOffers`, the relic pool and its pick, offers and rng state equal; the state paths
  (`drawPlayerCardOffers` vs `drawCardOffers` on the state's rng, `openDraft` classic); sword-only / bow-only state draws
  never deal the other weapon's boons or duos (with those boons force-owned); Mirror Cloak never in a bow-only relic
  pool. `sim/oneWeapon.spec.ts` (7): `[sword, undefined]` / `[sword]` / `[bow]` SWAP: no event, set 0 kept,
  `buildsOnSwap` not called (a `riposteCount` survives); a guard keeps running; two weapons swap as before (and back);
  an empty set 0 swaps to set 1; co-op per player, deterministic. `run/characterOffers.spec.ts` (3): 2,000 simulated
  builds runs per character and policy (greedy, random) to floor 21: a Knight never dealt Piercing Arrows / Ballista /
  Fire Arrows / Conductor / Skewer / Dragon Bolt (nor owns them), an Archer never Riposte / Thunder Guard / Stillwater /
  Rebuke, every other boon dealt; no mask deals every boon (printed: New cards per boon).
- **Ran** (on this commit's build): typecheck, lint, build; the three new specs 9 / 7 / 3; `shared/characters` 11;
  `sim/progression` 61, `sim/builds` 255, `sim/pacts` 33, `sim/treasure` 51, `sim/weapons` 20, `sim/hash` 6,
  `sim/constants` 7, `sim/runPlayer` 10, `sim/runFull` 6, `sim/runBoss` 6, `sim/runBullets` 8, `sim/determinism` 12,
  `sim/combat.determinism` 24, `sim/swordBow` 6, `sim/party` 19, `sim/recordingCodec` 19, `sim/player` 25,
  `dungeon/roomPool` 15 (7.4 min), `run/tutorial` 22, `run/buildsOffers` 2: all passed.

## AR3 (as built)

The Archer's dodge as per-player traits. Without traits (every golden fixture, M1, every spec and tool) the roll is
exactly today's: `scalePercent` / `combinedPercent` return their input unchanged at 100, so no hash moves.

- **Types** (AR1, `sim/playerData.ts`): `PlayerTraits { rollDashPercent, rollIframePercent }`, `NEUTRAL_TRAITS`.
- **Config**: `SimConfig.traits?: PlayerTraits` (player 0's; every player's fallback) and `PartyConfig.traits?:
  ReadonlyArray<PlayerTraits | undefined>` (per player, index 0 included), exactly like `loadout` / `loadouts`.
  `playerTraits(config, i)` (`sim/player.ts`, exported): `config.party.traits[i] ?? config.traits ?? NEUTRAL_TRAITS`, no
  allocation. Read from the RUN config: `step` / `stepParty` pass `playerTraits(config, i)` to `stepPlayer`'s new
  trailing `traits` parameter (default `NEUTRAL_TRAITS`), since `stepPlayer` gets the floor's world config. Not hashed.
- **Distance**: the dash tick's `dist` is `scalePercent(ROLL_DASH_STEP, traits.rollDashPercent)` (player.ts, the one
  line; Wrecker's roll smash reads the same `dist`). At 140: 0.25667 a tick, 3 `MAX_MOVE_STEP` sub-steps instead of 2,
  3.38 tiles in the same 21 ticks.
- **I-frames**: `rollIframeTicks(state, i, ticks, traitPercent = PERCENT)` (runMods.ts) =
  `scaleTicks(ticks, combinedPercent(Slippery's percent, traitPercent))`: one rounding. Archer 15 / 23 / 26 / 30,
  Knight 12 / 18 / 21 / 24 (AR0: the combined percents 187.5 / 218.75 / 250 are exact binary fractions).
- **Loadout precedence** (AR0's finding, needed by AR4): `createSimState` builds the weapons from
  `config.loadout ?? world.loadout` (`createCombatState(config, loadout = config.loadout)` takes it as a new optional
  argument) and passes the same to `createPartyState` as the run loadout. Identical for every non-endless config
  (config is the world) and for every endless config today (none sets a run-level loadout).
- The sim imports nothing from shared/characters.
- **Spec** `characters/archerRoll.spec.ts` (10): no traits / `NEUTRAL_TRAITS` / the Knight's / {100, 100} hash the same
  every tick; 140 %: 21 rolling ticks, every tick's step, 3.38 tiles to 1e-9 (the summed sub-steps; 45 resolver
  calls, the Knight's 33); i-frames 15 / 23 / 26 / 30 and 12 / 18 / 21 / 24 through `stepPlayer` (Slippery I-III by
  `grantCard`); a still enemy bullet on the player at roll tick 14 misses the Archer and hits the Knight; a roll into
  a wall stops flush at the wall's face for both, a diagonal roll slides along it, never overlapping a wall; a roll at
  an isolated pillar 0.2 off its line: the Archer slips round it (ends at (5.75, 3.85), past the 5.15 contact and
  fully clear in z), the Knight's shorter roll ends on its face (5.15, 3.56); co-op `PartyConfig.traits` (3.38 / 2.5 /
  2.5 for [Archer, Knight, none]) and the `SimConfig.traits` fallback; Wrecker; two Archer + Knight runs hash alike
  every tick.
- **Deviation:** the plan's "Wrecker's smash reaches a crate 3 tiles away" does not tell the characters apart: the
  smash reaches `PLAYER_RADIUS + hitRadius` (0.85) past the step, so the Knight's 2.5-tile roll breaks a crate 3 tiles
  ahead too. The spec checks 4 tiles (the Archer breaks it, the Knight does not) and 3 (both).
- **Ran:** see AR4 (this commit was verified on the AR4 tree: AR4 changes only shared/run, shared/daily and the
  tutorial's config; the sim suites below do not read them): `shared/characters` (archerRoll 10), `sim/player` 25,
  `sim/runPlayer` 10, the golden runs, determinism and builds suites listed under AR4.

## AR4 (as built)

Characters in the run configs. The world registry's `endless`, `daily` and `dev` builders always build characters (the
Knight for a missing pick), so every live endless run now carries one weapon: endless, daily and dev replays and scores
changed (`DAILY.ruleset` 13 -> 14); M1 (`game`, `dungeonNoEncounter`, `greybox`) and every golden fixture are
unchanged. Paths under `src/shared/run/` unless noted.

- **Options and echo:** `WorldBuildOptions.characters?: ReadonlyArray<CharacterId>` (per player, index order);
  `RunSetup.characters?` (config.ts: the characters the run was built with, defaults filled in; undefined for a run
  built without them); `RunConfigOptions.characters?` (passed to `buildEndlessRunConfig` for world "endless" only);
  `EndlessRunOptions.characters?` / `bothWeapons?` (endless.ts); `DevRunOptions.bothWeapons?: boolean` (dev.ts, the dev
  panel's "Both weapons" flag) and `buildDevRunConfig(seed, options, partySize?, characters = [])`.
- **Helpers** (`characters.ts`, new, in the run barrel): `partyCharacters(characters, partySize)` (each player's pick,
  else `DEFAULT_CHARACTER`; an entry that is not a character id throws, so a session start answers `config_error`;
  entries past the party ignored) and `withCharacters(config, characters, { bothWeapons? })` (solo: `loadout` /
  `traits`; co-op: `party.loadouts` / `party.traits` for every player; `bothWeapons`: `DEFAULT_LOADOUT` with the
  character's traits; returns a new config). `TUTORIAL_CHARACTER` "knight" (tutorial.ts).
- **Worlds** (worlds.ts): `endless` / `daily`: `buildEndlessRunConfig(seed, partySize, { characters: o.characters ??
  [] })`; `dev`: `buildDevRunConfig(seed, o.dev, partySize, o.characters ?? [])` (solo only, as before); `tutorial`:
  `buildTutorialRunConfig` always applies `TUTORIAL_CHARACTER` (whatever is passed); `game` / `dungeonNoEncounter` /
  `greybox`: unchanged (characters ignored). `SimController` (client) and `runSessions` (server) call
  `buildWorldSetup` without characters today, so both build the Knight and still agree (AR5 / AR7 pass the picks).
- **Kept without characters:** `buildEndlessRunConfig(seed, n)` with no `characters` option is exactly today's config
  (both weapons, no traits), so every bot, harness and census (`endlessBot`, `partyBot`, `pactsBot`, `vaultRun`,
  `buildTune`, `recordEndlessRun`) records as before; so does `buildRunConfig(seed, { world: "endless" })`, the legacy
  `validateRun` path (`LIVE_RUN_LIMITS`). **For AR5:** a sessionless endless submission (`submitRun`, no `runId`) of a
  live (Knight) run would fail that path's replay; the submission carries no character today.
- **Tutorial bridge (deviation, until AR6):** with the Knight's loadout the bow lesson (combat E) cannot be practised, so
  the director waives its `bow` / `heavyArrow` skills for a player who carries no bow (`TutorialDirector.carriesBow`,
  shared/tutorial/director.ts; with a bow, as before). The room still has to be cleared (the bot kills the turret with
  the sword). AR6 removes the step, the skills and this bridge.
- **`DAILY.ruleset`** 13 -> 14 (shared/daily/config.ts, ARD11), `daily.spec` 14.
- **Specs added:** `characterRuns.spec.ts` (11): endless / daily / dev solo per character (and no pick = the Knight);
  endless / daily co-op [Archer, Knight, missing] per player; dev "Both weapons"; the tutorial the Knight whatever is
  passed; the M1 worlds ignore characters (same state hash solo and co-op); tools without characters; the helpers and
  an unknown id; a Knight, an Archer and a mixed party of three replayed from a fresh setup hash the same every tick
  (and through `runReplay`), the Knight and the Archer differ. `snagCensus.spec.ts` gained a roll census (the same 30
  floors, cached for both tests; 8 key directions from every contact cell; the roll's per-tick steps cut as movePlayer
  cuts them): the Archer's roll has zero unexcused stalls with the slide in every class (the gate: pillars 0, never
  more than the web mover). Measured (30 floors, 55,871 start cells, 446,968 rolls each): slide 0 unexcused in every
  class for both characters (the web mover 8,912 pillar / 14,246 corner / ...); the stall counts are the same for
  both (42,544 slide, every one excused: a roll that stalls does so within its first 0.6 tile, before the dash
  lengths differ), and the Archer's rolls end 2.727 tiles out on average against the Knight's 2.065 (asserted
  farther). The census takes about 7 minutes headless now (the walks 3.8, the rolls 2.9).
- **Specs changed (re-recorded or adapted only for the loadout):**
  - `tutorial/tutorial.spec.ts` metrics pins (in order and out of order): bow lesson 5.3 -> 5.5 s, ember 9.3 -> 9.6 s
    (the Knight clears combat E with the sword).
  - `run/tutorial.spec.ts`: the run config's keys gain `loadout` / `traits`; the sweep-lock scenario arms
    `DEFAULT_LOADOUT` on the tutorial config (it checks that arrows are held too) until AR6.
  - `run/slice.spec`, `run/affixes.spec`, `run/pelletsCensus.spec`, `run/dropsCensus.spec`, `run/treasureCensus.spec`:
    their segmented LiveRun and validator take the recording's own config (`buildEndlessRunConfig(seed)`, both weapons)
    instead of the registry's (now the Knight's); no pinned value moved.
  - No layout digest, `roomPool.lock` digest, golden fixture or determinism pin moved.
- **Ran** (final build, Linux cloud box, 2 cores): typecheck, lint, build, check:assets; filtered suites, all passed:
  `shared/characters` 21, `sim/oneWeapon` 7, `run/characterOffers` 3, `run/characterRuns` 11, `shared/daily` 15,
  `run/config` 6, `run/endless` 41, `run/dev` 16, `run/party` 23, `run/validate` 31, `run/segments` 22, `run/tutorial`
  22, `shared/tutorial` 66, `run/buildsOffers` 2, `run/runSessions` 19, `run/partyProgression` 5, `run/playerMover` 5,
  `run/slice` 9, `run/affixes` 6, `run/pelletsCensus` 5, `run/dropsCensus` 4, `run/treasureCensus` 4, `play/liveRun`
  19, `sim/golden/payouts` 7, `sim/progression` 61, `sim/pacts` 33, `sim/treasure` 51, `sim/builds` 255, `sim/player`
  25, `sim/runPlayer` 10, `sim/runFull` 6, `sim/runBoss` 6, `sim/runBullets` 8, `sim/constants` 7, `sim/hash` 6,
  `sim/determinism` 12, `sim/combat.determinism` 24, `sim/swordBow` 6, `sim/weapons` 20, `sim/party` 19,
  `sim/recordingCodec` 19, `dungeon/roomPool` 15 (7.6 min), `run/snagCensus` 2 (6.7 min). Not run: the full
  unfiltered suite (`npm run verify`), so specs outside these filters that build live endless worlds through
  `buildWorldSetup` (view specs use `recordEndlessRun`, unchanged) were not exercised.

## AR12 (as built)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). Built on branch `archer-art`
from the owner's `2Archer` folder in `art/vendor/smallscale-archer/` (3,592 PNGs, gitignored). Not uploaded: the vale
pack draws the placeholder capsule for `class.ranger` until the files below have IDs in `packs/vale/assetIds.ts`.

**The set** (`art/atlases.json` `spriteSets["class.ranger"]`). A `frames` source with the new `source.naming:
"smallscale"` (`<Anim>/<facing>/<Anim>_<angle>_<2 f + 1, 3 digits>.png`: the export numbers every other frame of a
30-frame render, 001..029, so `frames` stay the knight's grid indices 0..14), facings `E NE N NW W SW S SE` at d x 45
degrees counter-clockwise from screen right, the output convention already. Checked by eye against the knight (Run
frame 4 at 2x, the knight's row (8 - d) % 8 under each): E / W stride right / left, N, NE and NW show the back, S, SE
and SW the front, facing for facing. `pixelsPerTileFrom: "class.vanguard"` (38 px a tile, the knight's on-screen
scale), the knight's pivot cut (body alpha > 240, lit; the shadow is black at alpha <= ~207), `noiseAlpha` 0, `pad` 0,
the 1 px outline sheets with `clipAtCellEdge`. The union box is 121 x 97 (source 5..125 x 31..127), smaller than the
knight's full 128 cell, so each animation is one 968 x 776 atlas (8 x 8 cells of 121 x 97; pivot (62, 72), the feet
of Idle S frame 0; body 52 px, the knight's 57). Rim clipped at the cell edge: `ranger-death` 2 cells (5 body px),
`ranger-attack2` 1 cell (1 px).

**Mapping and frames kept** (8 of 15, one atlas per animation, like the knight):

| Animation | Source | Kept frames | Why |
|---|---|---|---|
| `idle` | Idle | 0 1 3 5 7 9 11 13 (loop, 7 fps) | the knight's loop spacing |
| `run` | Run | 0 1 3 5 7 9 11 13 (loop, 12 fps) | the knight's |
| `roll` | Rolling | 0 2 .. 14 | stretched over the roll's 21 ticks (the Archer's longer roll keeps its time) |
| `hit` | TakeDamage | 0 2 .. 14 | the knight's |
| `death` | Die | 0 2 .. 14 (holds 14) | the knight's |
| `attack.1` (stream) | QuickShot | 0 1 2 3 4 5 6 7 | QuickShot is a 4-frame draw-and-loose cycle repeated (f0 = f4 = f8 = f12, measured: 0 px differ; the bow straight at the loose f0, bent f1-f3): frames 0-7 are two whole cycles |
| `attack.2` (charged shot) | Attack1 | 1 3 5 7 9 / 10 11 13 | f1-f6 reach for the quiver and nock, f7 turns into the draw, f9 the anchor at full draw, f10 the loose (the draw hand flies back off the string, checked in all 8 facings), f11 the follow-through, f12-14 the bow lowered |

Rejected: AttackRun (one crouch-lunge-and-shoot, 15 frames, not a loop: wrong for 5 arrows a second), Attack2 (the same
draw kneeling: it would slide under the charge's half-speed walk), Special1 (a shot into the sky), Attack3 (a jumping
shot).

**Segment marks** (`shared/view/config.ts` `SPRITE_ANIM_MARKS.archer`, the docs/DEMON_ART.md pattern): `release` 5 / 8
(`attack.2`: draw = kept 0-4, release = kept 5-7), `streamCycle` 4 / 8 (`attack.1`: cycle 0 = kept 0-3, cycle 1 = 4-7).

**View mapping** (`shared/view/sprites.ts`, pure; behind `ARCHER_SPRITE.visualId` = `class.ranger`, config.ts
`ARCHER_SPRITE`). `bowShot` / `bowShotOf` read the ACTIVE set's bow slot: `V_CHARGE > 0` -> the draw (`attack.2`
[0, release)) stretched over the charge (`bowChargeTicks`, Ballista II / III shorten it), the anchor held once full;
the tick after a heavy arrow (`V_HEAVY_TICK`) -> the release ([release, end)) over the stream's wait
(`BOW_DATA.heavyRecoverTicks`, 18 ticks); a running stream cooldown -> one `attack.1` cycle over that arrow's cooldown
(`attackTicks` of `BOW_DATA.cooldownTicks`: Swift Strikes), cycle 0 / 1 alternating by `V_SHOT`'s parity (so the two
slightly different loose frames alternate). Priority as the knight's: death > roll > bow > hit > run > idle. Moving
at run speed while streaming plays `run` instead (`ARCHER_SPRITE.streamYieldsToRun`: QuickShot is a planted stance and
the Archer kites); the draw and the release play whatever the speed. `archerSpriteInput` (no swing, the bow) and
`playerSpriteInputFor(visualId, state, i, alpha, swordIndex, bowIndex)`: the Archer's for `class.ranger`, exactly
`playerSpriteInput` with the sword for every other visual, so the Knight's choices are unchanged (a Knight with the
bow in hand, M1, still plays idle / run). A set without `attack.1` / `attack.2` (the placeholder; the core five
uploaded alone) falls through to what plays without them. **Not wired yet:** `ActorRenderController` still calls
`playerSpriteInput` for `ACTOR_VIEW.playerVisualId`; AR9 (the per-player visual) switches it to
`playerSpriteInputFor(visualId, ...)` with `weaponIndex("weapon.bow")`.

**Pipeline** (`scripts/art/build-atlases.js`). `--only <sprite set id>` builds one set alone: it checks the lock for the
set and its `pixelsPerTileFrom` chain (here the knight, built only to read its pixelsPerTile, never written), writes
the set's sheets, outline sheets (and their `art/upload/` copies) and `art/build/contact/<id>.png`, and merges its entry
into `layout.ts` (`mergeSpriteLayout`: replaced or inserted at its sorted place, every other byte unchanged: exactly
what `layoutModule` writes for all the sets); no stale sweep. `--lock --only <set id>` re-hashes the set's own files
into the lock. `source.naming` (`FRAME_NAMINGS`: `lordsOfPain`, the default, or `smallscale`). Run here:
`node scripts/art/build-atlases.js --lock --only class.ranger` (448 files added to `art/vendor.lock.json`, no entry
changed) then `--only class.ranger`. Every other output is unchanged: `layout.ts` gained only the `class.ranger` entry;
the knight's 16 sheets and contact sheet built by this script are byte-identical to the previous script's (compared
PNG by PNG); no other set or group was built.

**Files to upload** (14, `art/upload/`; required for the switch: the first five sheets): `ranger-idle.png`,
`ranger-run.png`, `ranger-roll.png`, `ranger-hit.png`, `ranger-death.png`, optional `ranger-attack1.png` (stream),
`ranger-attack2.png` (charged shot), and each one's `-outline.png` (the player rim; never holds the set back).

**Notices.** `THIRD_PARTY_NOTICES.md` "HD 8-Directional Top-Down Character Pack 1 (paid edition: Archer)" with owner
answer 10's terms; the Credits screen already listed the Knight's pack, so its line reads "HD 8-Directional Top-Down
Character Pack 1 (Knight, Archer)" (one line, not two of the same title). `art/README.md` names the folder.

**Specs.** `scripts/art/sprite-set-only.test.js` (naming, `--only` argv and scoped lock, the chain, outputs byte-equal to
a full build's, `mergeSpriteLayout` byte-equal to `layoutModule` inserted / replaced / first / last / alone, refusals,
and with the packs on disk the committed `class.ranger` and `class.vanguard` entries rebuild exactly);
`src/shared/view/archerSprite.spec.ts` (timings, `bowShot` draw / release / stream, active set only, priority, the run
yield, fallbacks, a real sim run with the bow alone: 36 draw ticks to the anchor, 18 release ticks, stream cycles 0 / 1 /
0 one per arrow; the Knight's input identical; the marks on the built set land on kept frames 0-4 / 5-7 and 0-3 / 4-7);
`vale.spec.ts` (`class.ranger` stays the placeholder as bundled and with any core sheet missing; with every id it is
sprites with both bow animations and the rim, at the knight's scale, and the pack validates; every `class.*` set
carries outline sheets). Studio item 5 (the Archer draws its own sprite and outline, the roll fills the longer roll)
waits for the upload and AR9.

## AR6 (as built)

The tutorial is the Knight's and one room shorter (owner answers 3 and 5, ARD7 / ARD16). No sim rule changed; the
tutorial's floor 1 is a new layout, so tutorial replays changed (no golden fixture, no endless, M1 or daily replay
moved; floor 2, seed 905, digest `c0fd5b19`, is untouched). Paths under `src/shared/` unless noted.

- **Rooms** (`run/tutorial.ts`): combat E left `TUTORIAL_ROOMS`: 10 rooms, the entrance 0, combat A-D 1-4, F 5, G 6,
  treasure 7, shrine 8, stairwell / boss 9 (`TutorialLessonId` loses `combatE`; `combatF` / `combatG` keep their names).
  Combat D's `next` is now `s` (the snake: entrance -> A -> B east, down to C, C -> D west, down to F, F -> G ->
  treasure -> shrine -> boss east). Every id is read through `planOf`, so `TUTORIAL_GUARD_ROOM` stays 4,
  `TUTORIAL_PELLET_ROOM` is 6, treasure / shrine / stairwell 7 / 8 / 9. Removed with the room: `TURRET_SNIPER_KIND`,
  placement `cover` (`TutorialPlacement` is `cluster | far`), `coverTiles`, `COVER_PILLAR_TILES` and the room-pillar
  walk in `run/tutorialLayout.ts` (no other user, AR0).
- **Seed** (`config/tutorial.ts`): `TUTORIAL.floor1.seed` 7574 -> **7511**. 7574 was the first seed from 7500 that is
  frost with its two frozen lakes in combat D and F and gave lesson E its cover; the same rule without the cover: frost,
  lakes in D and F (rooms 4 and 5), so combat G (room 6) keeps its open floor for the pellet ring. `node
  scripts/find-tutorial-seed.js --no-build --floor 1 --from 7500 --to 7700 --top 300 --theme frost`: 201 seeds scanned,
  all 201 pass `checkTutorialChain` (nothing needs cover now), 40 frost, 4 with lakes in exactly D and F (7511, 7615,
  7677, 7683): the first. The scan took 4-8 s (the build before it about 1.5 min). The script lost its cover column and
  gained `--theme KEY` (`scripts/lune/find-tutorial-seed.luau`, `scripts/find-tutorial-seed.js`). The floor is frost
  123 x 71, tour 198 tiles (legs 21, 23, 23, 25, 22, 25, 22, 17, 20), corridors 4, 4, 4, 4, 4, 4, 5, 5, 4 (the ellipse
  treasure room's rim), 136 decor pieces; combat G's ring keeps its 12 pellets.
- **Script** (`tutorial/steps.ts`, `director.ts`): step `bow` removed (17 steps); skills `bow` / `heavyArrow` and the
  director's bow reads (`bowIndex`, `heavyTick`, `bowInHand`, `sawBow` / `heavyBase` / `heavy`, the BOW imports) gone,
  and with them AR4's `carriesBow` bridge. The `weapons` highlight had no other user: removed from `TutorialHighlight` /
  `TUTORIAL_HIGHLIGHTS` and from GameHud's WeaponPanel line (`client/ui/hud/GameHud.tsx`). **For AR9:**
  `WeaponPanel`'s optional `highlight` prop (and its `forced` swap hint, client/ui/hud/WeaponPanel.tsx) is now never
  passed; it was left in place to keep AR9's file free of conflicts, so AR9 can drop it.
- **Strings:** `tutorial.prompt.bow.keyboard` / `.gamepad` / `.touch` removed from the placeholder manifest and
  `l10n/context.json` (no generated locale table held them). No other tutorial prompt names the bow or the swap, so the
  prompt var `{swap}` went from `view/hud/tutorial.ts` `tutorialPromptVars` (and `tutorialHud.spec`'s rows).
- **Funnel** (`onboarding/config.ts`): `TUTORIAL_FUNNEL_REVISION` 3 -> **4** (`t1r4`); `ember` .. `finish` 10..18 ->
  9..17 (`map` 10, `pellets` 11, `relic` 12, ..., `finish` 17); attempt funnel lessons 2-18, `completed` 19; onboarding
  lessons 4-20, `Completed` 21. Caps per docs/TUTORIAL_FUNNEL.md (`analyticsCatalog` budget spec): attempt bound 60,
  first attempt 82, `maxEventsPerAttempt` 88 -> **84** (bound + `exitEventReserve` 2, as in revisions 2 and 3),
  `maxEventsPerSession` 264 -> **252** (3 x 84); field combinations 2703 of 8,000.
- **Bot** (`run/testing/tutorialBot.ts`): the combat E branch, `wield`, `bowInHand`, `sees`, the bow stand-off in
  `fight`, `CHARGE_TICKS` / `BOW_RANGE` gone (every `wield(false)` was a no-op for the Knight). It completes floors 1
  and 2: in order 4114 ticks (68.6 s of sim), out of order 4554 (75.9 s), guide-steered 4133 (68.9 s, 0.990x the bot's
  walk), guard late 4077, pellets late 4333, map early / never / unavailable 4114; the boss fight 12.9 s; funnel 1..17.
- **Re-recorded pins** (every one moved by the new layout or the renumbering, nothing else):
  - `run/tutorial.spec.ts`: floor-1 digest `fc231be9` -> `e526f3cb`, tour 225 -> 198, nine corridors, the lesson and
    room-type tables (10 rows), six spawning rooms (was 7), `TUTORIAL_PELLET_ROOM` / the state's pellet lock room 7 -> 6;
    "lesson E" (cover) test and its pillar check removed. The sweep-lock scenario is the Knight's (AR4 armed
    `DEFAULT_LOADOUT`): 12 sword hits held, the lethal blow a held swing from 1 tile (the dry run holds FIRE to find
    its tick) instead of an arrow from 3.
  - `tutorial/tutorial.spec.ts`: 17 steps and the step lists without `bow`; `map` 10, `pellets` 11, names
    `[9, 10, 11, 12, 17]` = ember, map, pellets, relic, finish; marker targets 2 x 9 + 1; metrics rows in order
    attack 4 -> 3.9 s, guard 5.6 -> 5.7, ember 9.6 -> 9.2 (steps 9..17 renumbered), out of order flask 3.5 -> 3.4,
    guard 8.3 -> 8.5, ember 9.2; guard late: the hold 8 -> 16 ticks (shadows `[0.1, 0.2]` -> `[0.2, 0.3]`, the report
    0.3 s), its guard row 5 -> 5.1 s; the 25 s delay: 1604 -> 1612 ticks, 26.7 -> 26.9 s, guard row 31.6 -> 31.7 s.
  - `view/roomEdgeState.spec.ts`: 6 lesson rooms with enemies (was 7).
  - onboarding specs: `analyticsCatalog` (17 lessons, 60 / 82 / 84 / 252), `onboardingFunnel` (17, `Completed` 21,
    `t1r4`), `onboarding` (17, `completed` 19), `funnelReports` (`t1r4`).
- **Outro, for AR7:** behaviour unchanged (Start my first run is still the main menu's Play solo). The call site AR7
  changes is `src/client/controllers/ui/HudController.tsx`, the `startFirstRun` action: `click(() => {
  this.tutorial.closeOutro(); this.menu.playSolo(); })`: replace `this.menu.playSolo()` with opening the character
  screen (its Confirm then starts the solo run; Back returns to the outro or the menu, AR7 decides). The button itself is
  `client/ui/hud/TutorialOutro.tsx` (`actions.startFirstRun()`); `TutorialController.closeOutro`'s comment names Play
  solo.
- **Docs:** docs/TUTORIAL.md (status, the floor-1 tables, the seed, the lock spec, the step table, the funnel
  renumbering, decision 12), docs/TUTORIAL_FUNNEL.md (revision 4), docs/PELLETS.md / docs/TUTORIAL_MAP.md (one note
  each), CLAUDE.md (the pellets entry's tutorial room ids, seed, step and revision only).
- **Ran** (Linux cloud box, 2 cores shared): typecheck, lint, build; `l10n:check` (0 errors, 0 warnings), `test:l10n`
  (36 / 36), `check:autolocalize`; filtered suites, all passed: `run/tutorial` 21, `shared/tutorial` (tutorial 66
  incl. flow and guide), `onboarding` (7 suites), `sim/tutorial`, `run/playerMover`, `run/characterRuns` 11,
  `sim/builds/builds`, `view/roomEdgeState`, `view/hud/tutorialHud`, `view/hud/hud`, `shared/theme`, `shared/l10n`.
  Not run: the full unfiltered suite (`npm run verify`). Studio item 9 pending.

## AR5 (as built)

Server, lobbies and the client plumbing for the pick (no picker UI: AR7 / AR8). Every live run is now validated as the
character it was started with; M1, fixtures and tools are unchanged. Paths under `src/` unless noted.

- **Run sessions** (`shared/run/runSessions.ts`): `StartRunRequest.characterId?` replaces `classId` (limit
  `MAX_CHARACTER_ID_CHARS` 48, the renamed `MAX_CLASS_ID_CHARS`, `shared/run/limits.ts`): absent = `DEFAULT_CHARACTER`,
  not a string / too long / not a character id = `bad_request`. `StartContext.partyCharacters?` (a lobby party start's
  member picks, member order; an entry that is no character id = `bad_party`). `sessionCharacters(request, partySize,
  partyCharacters)` (exported): solo the request's; a party the lobby's picks (missing entries the Knight), or without
  them the owner's request and the Knight for the others; a party ignores the request's own `characterId`. The setup
  (what the validator replays) is `buildWorldSetup(kind, seed, { atBossDoor, partySize, characters })`.
  `RunSession.characters` = `setup.characters` (member order, defaults filled in; undefined for a world without
  characters: M1's `game`, `dungeonNoEncounter`, `greybox`). `StartRunReply.characterId?` echoes the owner's.
- **Legacy `submitRun`** (`shared/run/validate.ts`): `RunSubmission.characterId?`; checked in `checkShape` (unknown =
  `bad_submission`) and passed to `buildRunConfig(..., { characters: [id] })`. Absent = the world without characters
  (endless: both weapons, exactly as before), so every tool, census and `endless.spec`'s `validateRun(LIVE_RUN_LIMITS)`
  round trip are unchanged. The client always sends its run's character when it has one (SimController.submit), so an
  unranked endless fallback agrees with what it built.
- **Telemetry:** `RunTelemetryRecord.character?` (the replayed player 0's, `setup.characters[0]`; `RunTelemetry`'s new
  third constructor argument, set by `validateRun` and `SegmentedValidator`). Analytics: `RunDuration` gains field01 =
  the character (left out without one; catalog `set(CHARACTER_IDS, optional)`: 3 combinations). `RunRecapReport
  .character?` (the client's `RunContext.character`; `readRunRecapReport` drops a report whose character is present but
  no character id); the close row's field03 is `<flags>/<character>` (`RUN_RECAP_CHARACTER_SEPARATOR` "/", the Daily's
  combo separator), the flags alone without one: RunRecap 7 x 11 x 13 = 1,001 combinations (was 385). Catalog total
  3,378 of 8,000.
- **Leaderboard posting** (`server/services/RunSessionService.ts`): every member's `LeaderboardMember.classId` = their
  `RunSession.characters[i]` (was the owner's only, and never sent); absent for a run without characters. Field and
  details doc (`LB_Details_v1`) unchanged; records and daily boards unchanged.
- **Lobbies** (`shared/lobby/lobbies.ts`): `Lobby.characters` (member -> CharacterId; no entry = the Knight),
  `memberCharacter(lobby, id)`, `memberCharacters(lobby)` (member order). `setReady(userId, ready, characterId?:
  unknown)` (result gains `pickChanged`): an unknown pick is `badRequest`; a pick is stored whatever `ready` says (an
  un-ready with a pick changes the pick only); readying with the stored or the same pick readies; **a member already
  ready who sends another pick (ready or not) is un-readied** (a countdown is cancelled: the existing
  `countdownCancelled` notice). Un-ready, a world change and `runEnded` clear Ready and keep picks; leaving (or a kick)
  drops the pick. `LobbyRunStart` solo gains `characterId`, party `characters` (member order).
- **Remotes** (`shared/network.ts`): `lobbySetReady(ready: boolean, characterId: string)`; `LobbyView.characters:
  CharacterId[]` (same index as `members`, `lobbyViewOf`); `PartyRunStart.characters: CharacterId[]` (the session's,
  empty for a world without characters); `LobbySoloRunStart.characterId`. docs/SERVER.md's remote table, run-session
  diagram, co-op start and Lobbies notes follow.
- **Server services:** LobbyService passes the remote's pick to `setReady`; RunSessionService: `startLobbyRun` passes
  `start.characters` as `partyCharacters` and fires `lobbyRunStart` with the solo pick; `startLockstep`'s payload
  carries `characters`; `start()`'s reply carries `characterId`. The server does not force a solo lobby run's
  `startRun` to use the lobby pick (the client sends the pick it got in `lobbyRunStart`); the session validates
  whatever the request named.
- **The remembered pick (ARD12, done here: small):** `DisplaySettings.character` (shared/settings display.ts;
  default `DEFAULT_CHARACTER`, only another character id stored; settings document stays v2; in `DISPLAY_RESET_KEEPS`,
  so the Display tab's Reset keeps it; the all-groups reset clears it).
- **Client API for the picker (AR7 / AR8 build on this):**
  - `selectSelectedCharacter(state): CharacterId` (client/store settings.ts): the selected character, from the
    settings' display group (Knight until picked).
  - `SettingsController.setSelectedCharacter(id: CharacterId)`: sets it (applied locally at once, saved through
    `updateSettings`; the same pick sends nothing; an unknown id is ignored).
  - `SimController.startSolo(lobbyId?, worldKind?, character?)` / `startDev(options, seed, character?)`: the run's
    character, default the selected one; `startDev` now also passes `options.bothWeapons`. `SimController
    .getRunCharacter()`: the current / next solo run's. R, Again and a dev run's R keep the run's character
    (`runCharacter`), whatever is selected later; a ranked start adopts the reply's `characterId`.
  - `LobbyController.setReady(ready, characterId?)`: sends the pick (default the selected one); it does not change the
    selected character (the picker should call `setSelectedCharacter` on confirm). A solo lobby run plays the
    `lobbyRunStart` pick.
  - `RunContext.characters` / `.character` (the local player's) and `RunInfo.character` (client/store game.ts) for the
    view (AR9) and the run-over screen.
  - `SimController.startCoop` builds `buildWorldSetup(kind, seed, { partySize, characters: start.characters })`;
    `makeRun` builds every solo world with `characters: [runCharacter]` (the tutorial stays the Knight's).
- **Specs:** `run/runSessions.spec.ts` "characters" (6): `characterId` optional (Knight), the setup's loadout / traits
  per pick and the client's build equal to it, a world without characters records none, unknown / malformed ids
  `bad_request` with nothing created; `sessionCharacters` rules and a party of three [Archer, Knight, Archer] in member
  order (loadouts and traits per player), an unknown pick `bad_party`; a lobby's readied picks reach the session through
  its start; a party run of three picks validates segment by segment when every client builds the payload's
  characters, and a client that built three Knights is rejected `hash_mismatch` at the first checkpoint (tick 600); a
  solo run built as the Archer validates in an Archer session (telemetry `archer`) and fails `hash_mismatch` in a
  Knight session (named or default); the sessionless path validates with `characterId` "archer", fails as "knight" or
  absent (both weapons), `bad_submission` for unknown / too long. `lobby/lobbies.spec.ts` "character picks" (5): pick
  with Ready, kept on un-ready, shown in the view in member order, a pick without Ready; unknown picks refused; a pick
  change after Ready un-readies and cancels a countdown; the party start carries the picks in member order, a world
  change and `runEnded` keep them, leaving drops them; a solo start carries the pick (and the four existing start
  expectations gained the default picks). `settings.spec.ts` (2): the character key (default, stored only when not the
  Knight, junk dropped, v2 round trip, kept by the Display Reset); six full-settings expectations gained `character`.
  `analyticsCatalog.spec.ts`: the recap loop over no character and both, 7 x 11 x 13, `record/archer`; RunDuration's
  field per character, in the catalog, 3 combinations. `recapAnalytics.spec.ts` (1): reading and field03.
  `view/menu/menu.spec.ts`'s base `LobbyView` gained `characters: []`.
- **Ran** (this tree, Linux, 2 cores): typecheck, eslint on every changed file, build, check:assets,
  check:autolocalize; `shared/lobby` 84, `run/runSessions` 25, `shared/onboarding` 104 (catalog 3,378 / 8,000),
  `shared/settings` 63, `run/recapAnalytics` 21, `run/telemetry` 20, `run/validate` 31, `run/segments` 22,
  `run/characterRuns` 11, `shared/characters` 21, `play/liveRun` 19, `view/menu` 191, `shared/leaderboard` 85,
  `shared/daily` 15, `run/endless.spec` 14, `run/endlessSpawn` 22: all passed. Client / server code: typecheck, lint
  and build only (no engine here). Not run: the full suite, Studio.
- **Deviations / notes for later tasks:** the plan's "three different picks" is three members with picks (there are
  two characters): [Archer, Knight, Archer]. A member's lobby pick is the Knight until their first `lobbySetReady`; the
  client does not push its remembered pick on join (AR8 can send `setReady(false, pick)` when the lobby room opens).
  `lobbyRoomModel` member rows do not carry the pick yet (AR8). Older replays without a character cannot be validated
  as anything but the Knight in a session (the plan's edge case).

## AR9 (as built)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). Paths under `src/` unless noted.

- **The visual pick** (`shared/view/characters.ts`, new, in the shared/view barrel): `playerCharacterOf(characters,
  state, index)` (the run's pick `characters[index]` when it is a character id, else `characterOfWeapons` of the
  player's sets, else undefined: no state, outside the party, M1's two weapons), `characterVisualId(character)` (the
  def's `visualId`; none: `ACTOR_VIEW.playerVisualId`, the Knight's, as before) and `playerVisualIdOf` (both). A dev
  "Both weapons" run picked as the Archer draws the Archer (the pick wins over the weapons).
- **Client run characters** (`client/controllers/game/SimController.ts`): `RunContext.characters` (RunSetup.characters,
  through `MadeRun.characters` for `makeRun` and `setup.characters` in `startCoop`), `getRunCharacters()` and
  `getPlayerCharacter(i)` (playerCharacterOf on the run's state). `RunInfo.character` (`client/store/game.ts`): the
  local player's character id, "" for none (AR10's reader). AR5 / AR7 pass the picks into `buildWorldSetup`; until
  then every endless run is the Knight and draws the knight, M1 the knight, a hand-built one-weapon config its weapons'.
- **ActorRenderController**: each `PlayerView` carries its `visualId`; views are built per player from
  `playerVisualIdOf(sim.getRunCharacters(), state, i)` (cached per run state: loadouts never change in a run) and
  rebuilt (destroyed: sprite, capsule, pip, ring) when a player's visual changes at a new run. Sprites, the player
  outline's 1 px sheets and the ring's texel density are the set's own (the Archer's `ranger-*-outline.png` once
  uploaded); the placeholder capsule is the visual's (`class.ranger`'s green capsule). The animation input is AR12's
  `playerSpriteInputFor(view.visualId, state, i, alpha, sword, bow)` (`weaponIndex(BOW_WEAPON_ID)`, cached like the
  sword's), so the Archer's set plays the draw / release / stream and the Knight's exactly as before. Feel (squash,
  roll afterimages: MotionFx snapshots whatever sprite the view has) and spectate (the view index only) needed no
  change: nothing else read `ACTOR_VIEW.playerVisualId`.
- **Swap prompts** (`shared/view/hud/weaponSets.ts`, new): `hasSwapTarget(weapons)` (at least two sets hold a weapon;
  `weapons` is the snapshot's id per set, "" empty) and `shownWeaponSets(weapons)` (every set with a swap target or
  with no weapon at all, else only the held set). WeaponPanel draws `shownWeaponSets` (a Knight's or an Archer's one
  slot, numbered by its set) and the timed SwapHint only with `hasSwapTarget`; the pause overlay's swap key line (the
  "pad hint's swap glyph": `E swap` / `Y swap`, `HUD_STRINGS.weaponSwap`) likewise. Touch
  (`shared/view/hud/touchLayout.ts`): `TouchButtonFacts { atShrine, swapTarget }`, `touchButtonShown(id, facts)` (Accept
  at a shrine, Swap with a swap target, everything else always) and `shownTouchButtons(layout, facts)`;
  TouchControlsController's visibility uses `touchButtonShown` (a hidden GuiButton takes no touch). The layout itself
  is unchanged and places every button whatever shows, so hiding Swap moves or resizes nothing.
- **Character icons** (`shared/view/hud/characterIcon.ts`, new): `characterIcon(character, hasImage)` (an untrusted
  value; `{ character, art, role }`: `ui.character.<id>` when the pack has it, else the square in the visual's colour
  role `class.vanguard` / `class.ranger`; undefined for anything not a character id), `characterIconSize(rowHeight)`
  (0.6 of the row, whole px), `CHARACTER_ICON_VIEW`, `CharacterTagged` / `characterOfEntry(entry)` (an entry's
  `classId` when it is a character id: `LeaderboardRow` has no `classId` field yet, so the panel reads it structurally;
  AR5's entries render once they carry it). Client `client/ui/hud/CharacterIcon.tsx` (`CharacterIcon`, ArtImage with
  the square as its fallback; `hasCharacterIcon`). Drawn on the leaderboard's rows (before the name, the name column
  gives up the icon's width), the run-over contribution's Party rows (at the name column, dimmed with a leaver's row)
  and the You card's header. `ContributionInput.characters?` / `ContributionRow.character?`
  (`shared/view/hud/contribution.ts`), filled by RecapController from `sim.getPlayerCharacter(i)`.
- **Spec** `shared/view/characters.spec.ts` (5): the visual per character and the fallback, the pick over the weapons
  (dev Both weapons as the Archer through `buildWorldSetup`), co-op per player and out of range, an endless setup's
  echo. `shared/view/hud/archerHud.spec.ts` (13, with AR10's): `hasSwapTarget` / `shownWeaponSets`;
  `touchButtonShown`; hiding Swap keeps every other button's box (every `TOUCH_TEST_VIEWPORTS` entry, both hands, HUD
  100 / 130 %: `shownTouchButtons` equals the layout's buttons minus Swap, circle for circle); `characterIcon` /
  `characterOfEntry`; contribution rows carry characters.
- **Deviations:** the recap's icons are the party run-over's (the You card and the Party rows); a solo run-over shows
  none (the panel has no player row; RunOverPanel is left to AR7). `hasSwapTarget` reads only the snapshot's weapon
  list (two held sets), not the active set: an empty set 0 with a weapon in set 1 (no live loadout) shows no prompt.
  The tutorial's forced swap hint (the bow lesson's `weapons` highlight) is hidden for the tutorial's Knight too; AR6
  removes that step.

## AR10 (as built)

Presentation only. Optional overrides `<key>.<characterId>` read for the LOCAL player's character.

- **Lookup** (`shared/view/hud/characterText.ts`, new): `HasString`, `characterStringKey(key, character, has)` (the
  override `characterOverrideKey(key, character)` when the pack has it, else `key`; no character or "" -> `key`),
  `characterHudText(t, character, has)` (the key and every varKey; the same object when nothing changes),
  `characterDraftCard(model, ...)` (name, banner, line, an Upgrade's "was" line, the duo hint),
  `characterTooltip(model, ...)` (title, kind line, body lines: the level-II "Evolves into {evo}: {desc}" reads the
  evolution's override through its varKey), `characterBuildRow` / `characterBuildSections`. The models
  (`draftCardModel`, `itemTooltip`, `buildListSections`) stay character-free; the client wraps what it shows:
  DraftRevealController (`sim.getPlayerCharacter(ctx.localIndex)` at the deal), ItemTooltip and BuildList
  (`RunInfo.character`), each with the active pack's `hasString`. No codex exists yet (nothing to wire). Greed's deal
  goes through the same draft cards.
- **The overrides** (placeholder manifest; vale's `strings` are the placeholder's, `vale.spec` checks it): the plan's
  five items in seven strings (`CHARACTER_OVERRIDE_KEYS`, theme characters.ts): `boon.swiftStrikes.evo.desc.archer`,
  `boon.bastion.desc.archer`, `duo.stormBlade.desc.knight` / `.archer`, `duo.fullHeart.desc.knight` / `.archer`,
  `duo.citadel.desc.archer`, the table's text as written. The Knight's "(unchanged)" cells and the Knight's Swift
  Strikes line (the base text already) have no override. Not required (no pack must define any); M1's two-weapon
  player (no character) reads the base lines.
- **Spec** `shared/view/hud/archerHud.spec.ts` (per-character text): `characterStringKey` (override, base for the
  Knight, no / "" / unknown character, a key without an override, a pack without overrides); the Archer's Bastion card
  reads "+1 armor pip; roll through 8 bullets: +1 pip", the Knight's the base line, no character the model itself;
  Storm Blade / Full Heart / Citadel per character; Swift Strikes' Evolution card and the level-II tooltip's varKey;
  Bastion's tooltip and the Build list (boon and duo rows) per character. `shared/theme/characters.spec.ts`: the seven
  overrides' text, each with its base key, none required, present in both packs.

## AR11 (as built)

Theme strings only (no new colour role, sound or asset; no contract constant).

- **Names** (owner answer 11): `class.vanguard.name` "Knight", `class.ranger.name` "Archer" (were "Vanguard" /
  "Ranger"; ARD1).
- **Character screen** (`shared/theme/characters.ts`, new, in the theme barrel): `CHARACTER_SCREEN_STRINGS` { `title`
  `character.title` "Choose your character", `start` `character.start` "Start", `runOverCharacter`
  `run.over.character` "Character" }, `CHARACTER_SUMMARY_LINES` 2, `characterLineKey(id, n)` (`character.<id>.line.<n>`:
  Knight "Sword: a three-hit combo." / "Guard blocks bullets.", Archer "Bow: a stream of arrows, hold to charge." / "A
  longer, safer roll."), `THEME_CHARACTER_IDS` (["knight", "archer"], written out: the theme imports no gameplay
  module; the spec keeps it equal to `CHARACTER_IDS`), `characterStringKeys()` (the seven), `characterOverrideKey`,
  `CHARACTER_OVERRIDE_KEYS`, `CHARACTER_ICON_PREFIX` "ui.character." / `characterIconId(id)` (optional free-form ui
  images like the boon icons; neither bundled pack has one). The seven screen strings are REQUIRED: written out inside
  `REQUIRED_STRING_KEYS`' function after the class names (no import, no top-level local); `contract.spec`'s count +7.
  A character's name is its visual's `class.<id>.name`.
- **Deviation:** the plan's `runOver.character` is `run.over.character`: the validator's first key segment is
  lowercase only (`STRING_KEY_FIRST`), so `runOver.*` is a bad string key.
- **l10n** (`l10n/context.json`): entries for the seven screen strings (with `max` budgets) and the seven overrides
  (each pointing at its base line's note); `class.vanguard.name` / `class.ranger.name` reworded (no longer
  "Reserved"). The two renamed classes' locale entries are stale until re-translated (English shown, as for any
  rewording).
- **Luau locals** (counted on `out/`, top-level `local` names): `contract.luau` 186, `validate.luau` 197 (unchanged).
- **Spec** `shared/theme/characters.spec.ts` (7): ids equal `CHARACTER_IDS`; the two names; the screen's keys equal the
  list, required, in both packs; the working text; the overrides; icons optional and absent; both packs validate.
- **Ran** (this tree, Linux cloud box): typecheck, lint, build, check:assets, check:autolocalize, l10n:check (0 errors, 0
  warnings), test:l10n (36); filtered suites, all passed: `shared/theme` 54 suites / 691, `view/hud` + `view/menu` +
  `view/archerSprite` + `view/sprites` + `view/characters` 55 / 925, `shared/play` + `view/fx` 46 / 652. Client code
  is checked by typecheck / lint / build only; Studio items 5, 6 and 8 wait for AR5 / AR7 (the picks reach the run
  configs) and AR12's upload.

## AR7 (as built)

Client input and presentation only (no sim, dungeon, lockstep, hash, replay, fixture, score or server change). Every run
started from the menu now goes through the character screen; Again does not (owner answers 2 and 8). Paths under
`src/` unless noted.

- **Pure model** (`shared/view/menu/character.ts`, in the menu barrel): `CharacterScreenOrigin` (`solo` / `daily` /
  `outro` / `dev` / `lobby` / `runOver`); `characterCards()` (CHARACTER_IDS order: id, `visualId`, the placeholder
  colour `role`, `nameKey` = `class.<visual>.name`, `lineKeys` = `character.<id>.line.1` / `.2`);
  `characterInitialFocus(lastPick)` (the remembered pick, junk -> the Knight), `characterFocusIndex`,
  `characterFocusStep` (one card per press, held at the ends, no wrap); `CHARACTER_SCREEN_KEYS` /
  `characterKeyAction` (Left / Up / A / W prev, Right / Down / D / S next, Return / KeypadEnter / Space confirm);
  `characterConfirmPlan(origin)` (start `solo` / `daily` / `dev` / `restart` / `ready`, whether the outro reports
  first, then `close` or `back`); `characterBackAction(nav)` (`back` when the screen sits over another menu screen,
  else `close`); `characterConfirmKey` (Ready in a lobby, else Start); `CHARACTER_VIEW` (cards 232 wide, 280 in the
  portrait column; previews 128 / 72 compact / 96 column; Start 160 x 40, Back the menus' small button) with
  `characterArrangement(compact, narrow)` (`row` / `compact` / `column`), `characterLayout`, `characterCardHeight`,
  `characterContentHeight`; the preview's `characterPreviewFacing` (screen angle 270: the S row of the pipeline's 8
  facings), `characterPreviewFrame` (the idle loop at its fps; reduced motion holds frame 0) and `characterPreviewSize`
  (the cell fitted into the square, whole px). The run-over button: `runOverCharacterShown(coop, again, recapOn,
  character)`, `runOverExitButtons`, `runOverExitRowWidth`, `runOverExitsRowWidth`, `runOverExitLayout(buttons, layout,
  gap, asideAllowed)`.
- **Nav, pad, skin, music, pause:** `MenuScreen` gains `character`; `PAD_SURFACES.character` (`screen` layer, A select,
  B back, no shortcuts; `PAD_SURFACE_IDS`); `UI_SCREEN_SKINS.character` = the menus' red frame; `pauseOverlayShown`
  also hides under a menu screen (`PauseView.menuScreen`, which PauseOverlay now fills: only the dev panel's Go over a
  paused run puts one there).
- **Store** (`client/store` menu slice): `menu.character` (`CharacterScreenState { origin, focus }`,
  `setCharacterScreen`, `setCharacterFocus`, `selectCharacterScreen`).
- **Routing** (`client/controllers/ui/MenuController.ts`; HudController wires the actions):

  | Start | Opens over | Confirm | Back |
  |---|---|---|---|
  | Play solo (main menu) | the main menu | `startSolo(_, _, pick)` (KV_Daily: the Daily), menu closes | the main menu |
  | the Daily card's start | the main menu | `startSolo(_, DAILY_WORLD_KIND, pick)` | the main menu |
  | the outro's Start my first run (`startFirstRun`, replaces AR6's `closeOutro(); playSolo()`) | no menu (the outro card hides under it, still open) | `TutorialController.closeOutro()` (reports `firstRun`), then the solo start | the outro card again |
  | the dev panel's Go (`DevModeController` -> `devStart`) | the menu it was on, or no menu (a solo run still being played pauses first) | `startDev(panel options incl. "Both weapons", seed, pick)` | the menu, or no menu (the pause overlay) |
  | run over: Character | no menu (the run-over panel hides under it) | `SimController.restartAs(pick)` | the run-over panel |
  | a lobby member's Ready (AR8) | the lobby room | `LobbyController.setReady(true, pick)`, back to the room | the lobby room, still unready |

  Every Confirm first calls `SettingsController.setSelectedCharacter(pick)` (the remembered pick, ARD12). Backspace and
  pad B on the screen are `characterBack` (`screenBack` routes it), so the screen closes at the root instead of doing
  nothing. Arrows / A-D and Enter / Space are read in `MenuController.onInput` (not under a panel). Leaving the screen
  any way (Back, Confirm, a run start, a lobby move) drops its request (`dropCharacter`). `KV_SkipMenu` (debug) still
  starts its solo run at once as the selected character.
- **Again** keeps the run's character, verified on AR5's code: R, Again and the pause overlay's Restart all go
  `requestRestart` -> `handleReset` -> `beginRun` / `beginDev`, whose `makeRun` builds `characters: [runCharacter]`;
  only `startSolo` / `startDev` / the new `restartAs` (and a ranked reply echoing it) set `runCharacter`.
  `SimController.restartAs(character)`: sets it and requests Again's restart (the same world, a dev run's options and
  seed); ignored in a party run.
- **Screen** (`client/ui/menu/CharacterScreen.tsx`, mounted by MenuLayer): a `screen` focus scope whose default is the
  card focused when it opened; the title, the cards (a horizontal row; a column in portrait; smaller previews on a
  landscape phone), Start (Ready in a lobby) and Back, then the back-key hint (keyboard) or the pad hint bar. A card is a
  selectable TextButton: the focused one outlined in uiAccent (3 px), the other dimmed; a tap / click focuses it (a
  click sound), the pad's selection focuses it as it moves (`SelectionGained`), and the pad's A on it confirms it.
  `CharacterPreview` draws the visual's sprite set (`ThemePack.sprites(visualId)`) idle animation facing the camera,
  frame by frame through a binding on Heartbeat, `ResampleMode` from the set; without a set with `idle` (the Archer
  until AR12's upload, the placeholder pack) a capsule in the class colour role. No timer. Fitted by MenuFit (touch,
  console TV-safe).
- **Run over** (`client/ui/hud/RunOverPanel.tsx`): **Character** (`run.over.character`) beside Again for a solo run
  played as a character with the recap's exits (`runOverCharacterShown`; never a party run's Back to lobby). The exits
  stay today's single row when they fit; with Character and Details: wide / narrow put Again + Character on the first
  row and the exit + Details under them; compact (a landscape phone) keeps Again, Character and the exit in one row
  (exactly the left column's 400) and moves Details atop the right column (`detailsAside`, scored runs only: an extra
  left-column row overflowed the 693 x 320 phone's floor). Again keeps order 1, its size, the `firstRef` focus and its
  retry gate; Character never goes through `RunOverRetryGate` (it calls `HudActions.runOverCharacter`). While a menu
  screen is up the panel is not drawn (RecapController's `pressAllowed` already ignored presses under one), so its
  scope gives the pad to the character screen; Back remounts it with Again selected and `recap.armed` untouched.
  TutorialOutro likewise hides (and goes inactive) under a menu screen.
- **Dev panel** (`client/ui/dev/DevPanel.tsx`, `DevModeController`): a **Both weapons** toggle (`DEV_PANEL_VIEW.strings`
  `bothOn` / `bothOff`, developer English like the rest of the panel) passed as `DevRunOptions.bothWeapons` (AR4's flag
  had no button); Go asks for the character first.
- **Specs:** `shared/view/menu/character.spec.ts` (cards, strings in the placeholder pack, focus order / last pick /
  keys, the pad surface, Confirm plans, Back targets for every origin through `menuNavReduce`, the lobby path under the
  screen, run-over Character rules and exits layout, the preview's facing / frame / size, fit: the three landscape
  phones at 70-125 % compact without overflow and above the floor (the two reference phones at full size), three
  portrait phones in the column, three console sizes at full size inside the TV-safe area with the hint bar, desktops
  never fitted). `fit.spec.ts`: the run-over recap's worst case now carries Character (two exit rows wide / narrow,
  Details aside compact) and still fits every phone, portrait phone and desktop. `pause.spec.ts` (the overlay under a
  menu screen), `skin.spec.ts` (the screen listed).
- **Ran** (this tree, Linux, 2 cores): typecheck, lint, build, check:assets, check:autolocalize, l10n:check (0 / 0),
  test:l10n (36); `view/menu` 12 suites / 214 (character 23) on the AR7 commit, `view/audio` + `view/hud` 56 / 814. Client code: typecheck,
  lint and build only. Not run: the full suite, Studio.
- **Decisions / deviations:** Back from the outro's screen returns to the outro card (AR6 left the choice to AR7): the
  card stays open under the screen and its `outro` report fires only on Confirm. Compact run over moves Details (above). `R` on the character screen over
  a run-over still restarts at once as the run's character (the driver key is SimController's; the menu then closes).

## AR8 (as built)

Client only (AR5 built the server side). Paths under `src/`.

- **Ready opens the screen:** the lobby room's Ready button and its pad X shortcut call `MenuActions.toggleReady`
  (`MenuController.toggleReady`): a ready member un-readies at once (the pick kept); a member who is not ready and the
  lobby forming gets the character screen over the room (origin `lobby`, confirm label Ready). Confirm =
  `setReady(true, pick)` and back to the room; Back = the room, still unready.
- **Member rows** (`shared/view/menu/lobby.ts`): `RoomMember.character` from `LobbyView.characters[i]` (undefined for a
  missing entry or no character id); `client/ui/menu/LobbyRoom.tsx` draws it as a `CharacterIcon` (now exported from
  the `client/ui/hud` barrel) before the name, the name cell giving up the icon's width (the leaderboard's rule).
- **The pick shown before a Ready:** `lobbyPickToSend(view, me, selected)` (forming, a member, not ready, the view's
  pick for me differs from the remembered one) -> `MenuController.syncLobbyPick` sends `setReady(false, pick)` when the
  lobby room opens and on lobby view changes while it is up, once per lobby and pick (`pickSent`). A Confirm from the
  screen marks its pick as sent, so the room reopening never follows the Ready with an un-ready.
- **Lobby moves under the screen:** `lobbyChangePath(screen, id, prev, stack)` (new optional `stack`): over the lobby
  room a lost lobby (left, kicked) goes to the browser, another lobby to its room; over no menu (run over, outro, a dev
  run) nothing moves.
- **Music:** `musicPlace(runActive, screen, under)`: the character screen over the lobby room keeps the lobby's music
  (AudioController passes the nav stack's top).
- **The host's Start** uses the picks: nothing new on the client (AR5's `partyRunStarted.characters` /
  `lobbyRunStart.characterId` carry what each member readied with).
- **Specs** (`character.spec.ts`, "the lobby room's picks"): member rows carry each pick by index (missing / unknown
  -> none); `lobbyPickToSend` sends only when it differs and the member is not ready, forming, a member (and with no
  entry yet). The lobby path cases under the screen (see AR7). `audio.spec.ts`: the lobby music under the screen.
- **Ran** (final tree): typecheck, lint, build, check:assets, check:autolocalize; `view/menu` + `view/audio` +
  `view/hud` 68 suites / 1,030 (character 25). l10n unchanged (no new string). Not run: the full suite, Studio.

Studio checklist (AR7 / AR8, not verifiable headlessly; items 1-4 of the plan's list):
1. Main menu Play solo, the Daily card's start, the tutorial outro's Start my first run and the dev panel's Go each open
   the screen with the last pick focused; mouse (click a card, Start), keyboard (arrows / A-D, Enter / Space,
   Backspace), gamepad (the D-pad moves between the cards and focuses each, A on a card starts, B back, the hint bar),
   touch (tap a card, Start) and a portrait phone (the column) and the smallest landscape phone (compact previews).
2. Back returns to the main menu / the lobby room; from the outro the card shows again (and its `outro` report fires only
   on Confirm); from run over the panel shows again with Again focused, its arm and recap untouched; from a dev Go in a
   run the pause overlay shows (the run paused).
3. Again restarts at once as the run's character (and armed at 0.6 s as before); Character opens the screen and Start
   restarts the same world as the pick; Retry Daily likewise; a party run's run over has no Character. Wide / narrow
   run over with highlights: Again + Character over the exit + Details; landscape phone: Details atop the right column.
4. Two clients in a lobby: each member's row shows their pick (the remembered one as soon as the room opens, before
   any Ready); Ready opens the screen and readies with the pick; Back stays unready; the host's Start runs each member
   as their pick (a mixed party); a kick or a leave while on the screen goes to the browser.
5. The idle preview: the Knight's sprite facing the camera and looping (reduced motion: still); the Archer's capsule
   until AR12's upload, then its sprite at a sensible size in the 128 / 72 / 96 squares; the console TV-safe fit.

## AR13 (as built): tuning

Branch `archer-tuning`. **Measurements only: no gameplay number or rule changed**; the recommendations at the end are
owner calls (they feed "Open owner calls" 1). Test support and specs only, plus one test-runner flag.

**Harness changes** (paths under `src/shared/run/testing/` unless noted):
- `characterTune.ts` (new): the character dimension on BU13's / LG7's harnesses. `TuneCharacter` = `knight` /
  `archer` (built through the real path: `characterConfig` = shared/run `withCharacters`, the character's loadout and
  roll traits on the run config, which wins over the arena world's weapon) or `both` (the old two-weapon player:
  `DEFAULT_LOADOUT`, no traits). **The fighter** (`fighterFrame`), one policy per character shared by the arena fights
  and the survival bot: every mode rolls by the same volley rule (2+ enemy bullets, goo not counted, within 1.6: a roll
  toward the nearest, LG7's roll bot); `knight` walks in and holds FIRE in reach, guards (ALT) when a bullet is within
  the guard's trigger and the guard is ready, rolls only while the guard cools down; **`archer` is the bow mode**: kites
  at 5 tiles in sight, strafing, leading its target, **charges heavy shots back to back** (the charge may start during
  the stream's heavy recovery) while the target has more than 2 hp, no enemy is within 3 and no enemy bullet within 2.5,
  else streams; drops a charge when an enemy closes to 2; also rolls straight away from a body within 1;
  `archer-stream` the same without charged shots (BU13's bow); `both` walks in like the knight with the bow in hand
  beyond 4.5 tiles (streaming as it closes) and the sword inside 3 (one SWAP press per change), guards with the sword.
  Out of sight (a real floor) every mode walks the BFS path and holds fire. Arena fights (`characterFight`,
  `characterTtkRows`): BU13's open endless arena, god mode, builds and affixes on; `KIND_ROOMS` (one room per endless
  room kind plus LG7's two turret pairs), `TUNE_MAYHEM` / `TUNE_DEMONLORD`, `CHARACTER_BUILD_CASES` (a build a
  character is never dealt prints n/a). `rollReach` (Blazing Trail's embers along one roll) and `wreckerReach` (Wrecker I
  into crates on a real floor patch). `censusRequested()`.
- `survivalBot.ts` (new): the endless survival census (an honest solo descent; below).
- `legendaryTune.ts`: `defenseFight` / `defenseRows` take an optional `character` (the run config built through
  `withCharacters`), so LG7's hold bots measure each character's own roll or guard. `buildOffers.ts`: per checkpoint
  `greedPoolEmpty` / `greedPoolSize` (legendaryPool with the mask). Exported through the testing barrel.
- **Opt-in census:** the headless runner takes `--census` (`scripts/lune/run-tests.luau`: sets the Workspace attribute
  `KV_Census`, which the harness Instance's `GetAttribute` now answers; `scripts/lune/lib/Instance.luau`). Nothing in
  the repo had a skip convention (the existing censuses, e.g. `snagCensus` 7 min, simply run in the full suite), so the
  survival census runs a 2-seed, 3-floor smoke sample (14 s) by default and its full sample only with
  `npm run test:only -- --census run/archer.survival`.

**Specs and runtimes** (Linux cloud box, 2 cores shared with another agent; headless; each prints its tables with an
`[archer tune]` / `[archer survival]` prefix and asserts loose bounds only): `sim/archer.ttk.rooms` (95 s),
`sim/archer.ttk.builds` (41 s), `sim/archer.ttk.boss.mayhem` (33 s), `sim/archer.ttk.boss.demonlord` (18 s),
`sim/archer.roll.hold` (65 s), `sim/archer.roll.fight` (25 s), `run/archer.offers` (57 s), `run/archer.survival` (14 s
smoke; **307 s** with `--census`: 12 seeds x 3 characters to floor 20).

**Method.** Arena fights: solo, the state's endless floor and Depth set before anything spawns (Depth after every boss on
the way), god mode (hearts refilled after every step; hits that landed counted: a pressure measure, "hits / min"), the
build granted before tick 0, the target the nearest living actor. "Both" is the reference for "the old swap player":
the ratios are character / Both (> 1 = slower than the old player). Turret pairs (M1 sandbox kinds, never in endless
rooms) revive 6 s after death, so their "clear" is the first tick both are down at once (cap 90 s, "t/o" past it).

### 1. Rooms by kind (no build; seeds 1-3, mean seconds to clear; f2 / f6 / f11 / f20 spawn hp)

| room | Knight | Archer (charge) | Archer (stream only) | Both (old player) | Knight x Both | Archer x Both | stream x Both | hits / min at f20 K / A / As / B |
|---|---|---|---|---|---|---|---|---|
| 8 swarmer (pack) | 1.4 / 1.4 / 1.8 / 3.5 | 3.2 / 4.5 / 5.1 / 10.2 | 3.2 / 4.7 / 9.5 / 16.2 | 1.4 / 1.4 / 1.8 / 3.5 | 1.00 / 1.00 / 1.00 / 1.00 | 2.28 / 3.24 / 2.89 / 2.88 | 2.28 / 3.38 / 5.40 / 4.59 | 68 / 0 / 0 / 68 |
| 3 sniper | 4.2 / 5.2 / 8.6 / 15.3 | 2.5 / 7.3 / 12.6 / 26.1 | 4.6 / 8.0 / 14.7 / 28.8 | 3.1 / 4.9 / 7.4 / 13.5 | 1.34 / 1.05 / 1.16 / 1.14 | 0.80 / 1.48 / 1.70 / 1.94 | 1.48 / 1.63 / 1.98 / 2.14 | 9 / 1 / 3 / 6 |
| 2 bruiser | 2.3 / 3.7 / 7.6 / 12.5 | 4.0 / 6.8 / 11.9 / 21.5 | 4.4 / 9.3 / 16.6 / 36.6 | 2.3 / 3.7 / 7.0 / 12.1 | 1.00 / 1.00 / 1.10 / 1.03 | 1.71 / 1.83 / 1.71 / 1.78 | 1.90 / 2.52 / 2.38 / 3.02 | 69 / 4 / 8 / 69 |
| 3 imp | 3.9 / 4.9 / 6.8 / 10.3 | 5.0 / 9.3 / 15.7 / 25.8 | 3.6 / 6.1 / 11.4 / 21.6 | 2.5 / 4.1 / 5.0 / 8.8 | 1.56 / 1.20 / 1.36 / 1.16 | 2.00 / 2.28 / 3.15 / 2.92 | 1.43 / 1.50 / 2.28 / 2.44 | 2 / 3 / 2 / 2 |
| 2 slime (+4 small) | 2.8 / 6.4 / 10.0 / 16.0 | 5.0 / 10.1 / 14.8 / 24.5 | 7.0 / 13.1 / 24.7 / 59.2 | 2.8 / 5.3 / 10.0 / 16.0 | 1.00 / 1.20 / 1.00 / 1.00 | 1.83 / 1.90 / 1.48 / 1.53 | 2.52 / 2.46 / 2.47 / 3.71 | 79 / 0 / 23 / 79 |
| 1 summoner (+summons) | 1.5 / 1.9 / 3.0 / 5.4 | 1.4 / 2.0 / 4.4 / 9.7 | 1.5 / 4.1 / 8.3 / 22.4 | 0.8 / 1.5 / 2.6 / 4.7 | 1.80 / 1.33 / 1.16 / 1.15 | 1.74 / 1.39 / 1.69 / 2.05 | 1.81 / 2.81 / 3.19 / 4.74 | 15 / 0 / 0 / 13 |
| 4 bomber | 1.1 / 1.5 / 1.5 / 1.5 | 2.0 / 2.0 / 4.9 / 9.5 | 2.4 / 4.0 / 7.2 / 14.7 | 1.1 / 1.5 / 1.5 / 1.5 | 1.00 / 1.05 / 1.00 / 1.00 | 1.88 / 1.36 / 3.33 / 6.27 | 2.23 / 2.72 / 4.84 / 9.67 | 40 / 0 / 0 / 40 |
| 2 charger | 4.7 / 6.8 / 10.0 / 20.5 | 3.9 / 8.2 / 14.2 / 28.1 | 6.0 / 11.9 / 22.3 / 46.0 | 3.3 / 5.9 / 9.3 / 19.6 | 1.42 / 1.15 / 1.08 / 1.05 | 1.16 / 1.38 / 1.53 / 1.43 | 1.82 / 2.01 / 2.40 / 2.35 | 9 / 0 / 0 / 9 |
| 2 stormcaller | 3.1 / 4.1 / 6.0 / 10.3 | 3.6 / 4.7 / 6.6 / 12.8 | 3.0 / 5.4 / 9.2 / 18.9 | 2.5 / 3.4 / 5.1 / 8.8 | 1.26 / 1.19 / 1.18 / 1.17 | 1.45 / 1.38 / 1.31 / 1.45 | 1.19 / 1.57 / 1.82 / 2.14 | 12 / 6 / 6 / 0 |
| 2 reaper | 3.9 / 4.2 / 7.6 / 13.8 | 2.6 / 4.9 / 7.7 / 14.8 | 3.4 / 6.7 / 12.6 / 25.8 | 1.6 / 4.5 / 7.2 / 13.6 | 2.46 / 0.93 / 1.06 / 1.02 | 1.67 / 1.08 / 1.07 / 1.09 | 2.18 / 1.47 / 1.75 / 1.90 | 23 / 4 / 6 / 24 |
| warbanner + 2 sniper + 2 swarmer | 3.0 / 4.1 / 8.3 / 17.6 | 5.9 / 9.0 / 15.0 / 30.7 | 6.0 / 9.9 / 17.6 / 34.3 | 2.6 / 3.8 / 7.8 / 16.0 | 1.14 / 1.10 / 1.06 / 1.10 | 2.27 / 2.39 / 1.92 / 1.92 | 2.29 / 2.65 / 2.26 / 2.14 | 10 / 1 / 2 / 10 |
| 2 turret.sprayer | 4.0 / 13.8 / 66.8 / 44.9 | 7.0 / 27.3 / t/o / 86.6 | 6.7 / 15.1 / 74.7 / t/o | 3.7 / 5.2 / 18.5 / 37.6 | 1.08 / 2.66 / 3.62 / 1.19 | 1.88 / 5.26 / - / 2.30 | 1.82 / 2.91 / 4.04 / - | 32 / 12 / - / 30 |
| 2 turret.caster | 16.6 / 25.2 / t/o / t/o | 7.0 / 15.7 / 69.4 / t/o | 7.6 / 41.1 / 69.0 / t/o | 9.0 / 48.8 / t/o / t/o | 1.85 / 0.52 / - / - | 0.78 / 0.32 / - / - | 0.85 / 0.84 / - / - | - |

### 2. Builds per character (pack seeds 1-3, census rooms seeds 1-2; f1 / f6 / f11 / f20)

The pack: 8 swarmers 5-7 units ahead. The census room per floor (BU13's `tuneCensusRoom` over solo runs 1-10, planned
affixes, \* = affixed): f1 run 2 room 0 (4 swarmer, 1 sniper); f6 run 2 room 7 (3 imp, 1 bomber, 2 swarmer, 1 sniper);
f11 run 10 room 3 (1 bruiser, 1 stormcaller, 1 warbanner, 1 summoner, 1 sniper, 1 charger\*, 2 swarmer); f20 run 6 room
1 (1 bomber, 1 charger, 2 sniper, 1 bruiser, 1 summoner, 2 imp\*, 1 warbanner, 1 reaper, 1 slime, 1 swarmer).

| fight | build | Knight s | Archer s | Both s | Knight x Both | Archer x Both | hits / min at f20 K / A / B |
|---|---|---|---|---|---|---|---|
| pack | no build | 1.4 / 1.4 / 1.8 / 3.5 | 1.6 / 4.5 / 5.1 / 10.2 | 1.4 / 1.4 / 1.8 / 3.5 | 1.00 / 1.00 / 1.00 / 1.00 | 1.15 / 3.24 / 2.89 / 2.88 | 68 / 0 / 68 |
| pack | Storm Blade (Chain Spark I + Swift Strikes I) | 0.3 / 0.5 / 1.2 / 2.5 | 0.5 / 2.6 / 3.4 / 8.1 | 0.4 / 0.5 / 1.0 / 2.5 | 0.95 / 1.00 / 1.24 / 1.00 | 1.23 / 5.03 / 3.39 / 3.27 | 65 / 0 / 65 |
| pack | Soul Swarm (Soul Shards III) | 0.4 / 0.4 / 0.7 / 1.1 | 0.3 / 0.9 / 0.9 / 4.8 | 0.3 / 0.4 / 0.7 / 1.1 | 1.31 / 1.00 / 1.00 / 1.00 | 1.00 / 1.97 / 1.31 / 4.46 | 56 / 0 / 56 |
| pack | Executioner (Sharpened III) | 1.4 / 1.4 / 1.4 / 1.8 | 1.6 / 3.4 / 4.1 / 5.5 | 1.4 / 1.4 / 1.4 / 1.8 | 1.00 / 1.00 / 1.00 / 1.00 | 1.15 / 2.40 / 2.94 / 3.08 | 68 / 0 / 68 |
| pack | Fire Arrows (Ember Wake + Piercing Arrows I) | n/a | 0.9 / 2.7 / 4.3 / 7.0 | 1.1 / 1.4 / 1.8 / 3.5 | - | 0.79 / 1.94 / 2.44 / 1.98 | - / 0 / 68 |
| pack | Siege Bolt (Ballista III) | n/a | 1.6 / 2.5 / 2.6 / 7.1 | 1.4 / 1.4 / 1.8 / 3.5 | - | 1.15 / 1.77 / 1.49 / 2.01 | - / 0 / 68 |
| pack | Counterstrike (Riposte III) | 1.4 / 1.4 / 1.8 / 3.5 | n/a | 1.4 / 1.4 / 1.8 / 3.5 | 1.00 / 1.00 / 1.00 / 1.00 | - | 68 / - / 68 |
| census room | no build | 2.1 / 6.9 / 27.3 / 62.0 | 1.6 / 14.5 / 46.5 / 121.8 | 1.7 / 5.7 / 24.6 / 61.2 | 1.24 / 1.21 / 1.11 / 1.01 | 0.96 / 2.54 / 1.89 / 1.99 | 27 / 12 / 26 |
| census room | Storm Blade | 1.6 / 6.5 / 23.0 / 57.3 | 1.3 / 15.9 / 38.8 / 103.4 | 1.1 / 4.5 / 21.2 / 55.4 | 1.48 / 1.46 / 1.08 / 1.03 | 1.24 / 3.57 / 1.83 / 1.87 | 30 / 9 / 30 |
| census room | Soul Swarm | 1.8 / 2.1 / 16.8 / 45.1 | 1.4 / 2.0 / 24.9 / 85.5 | 1.3 / 1.5 / 15.3 / 42.1 | 1.38 / 1.42 / 1.10 / 1.07 | 1.07 / 1.29 / 1.63 / 2.03 | 27 / 10 / 31 |
| census room | Executioner (Sharpened III) | 1.8 / 4.5 / 14.7 / 36.0 | 1.6 / 8.9 / 24.5 / 60.8 | 1.4 / 3.8 / 13.1 / 34.0 | 1.28 / 1.19 / 1.12 / 1.06 | 1.12 / 2.36 / 1.87 / 1.79 | 26 / 11 / 26 |
| census room | Fire Arrows | n/a | 1.6 / 12.0 / 33.8 / 70.6 | 1.6 / 5.7 / 22.0 / 48.3 | - | 1.03 / 2.12 / 1.54 / 1.46 | - / 10 / 27 |
| census room | Siege Bolt (Ballista III) | n/a | 1.5 / 10.0 / 19.6 / 58.7 | 1.7 / 5.7 / 24.6 / 61.2 | - | 0.88 / 1.76 / 0.80 / 0.96 | - / 11 / 26 |
| census room | Counterstrike (Riposte III) | 2.0 / 5.1 / 21.6 / 38.6 | n/a | 1.7 / 4.3 / 21.8 / 38.1 | 1.18 / 1.20 / 0.99 / 1.02 | - | 33 / - / 34 |

### 3. Bosses (boss floors 5 / 10 / 15 = Depth 1 / 2 / 3; seeds 1-2; the damage cap's floor hp / 6 = 45.0 / 67.5 / 101.2 s)

| boss | build | Knight | Archer (charge) | Archer (stream only) | Both | Knight x Both | Archer x Both | stream x Both | hits / min f15 K / A / As / B |
|---|---|---|---|---|---|---|---|---|---|
| Mother Mayhem | no build | 58.9 / 91.4 / 136.1 | 75.9 / 112.9 / 162.2 | 76.9 / 118.8 / 174.5 | 57.7 / 90.2 / 137.3 | 1.02 / 1.01 / 0.99 | 1.32 / 1.25 / 1.18 | 1.33 / 1.32 / 1.27 | 66 / 9 / 7 / 68 |
| Mother Mayhem | Soul Swarm | 56.8 / 89.7 / 134.7 | 69.4 / 101.9 / 150.4 | 69.7 / 103.2 / 161.0 | 57.6 / 87.9 / 133.2 | 0.99 / 1.02 / 1.01 | 1.21 / 1.16 / 1.13 | 1.21 / 1.17 / 1.21 | 66 / 9 / 8 / 68 |
| Demon Lord | no build | 51.8 / 76.3 / 113.3 | 66.0 / 97.0 / 142.2 | 68.6 / 108.2 / 161.2 | 50.8 / 77.2 / 114.3 | 1.02 / 0.99 / 0.99 | 1.30 / 1.26 / 1.24 | 1.35 / 1.40 / 1.41 | 74 / 7 / 4 / 73 |
| Demon Lord | Soul Swarm | 51.7 / 77.2 / 113.9 | 63.5 / 94.7 / 139.6 | 65.3 / 95.6 / 143.6 | 50.6 / 77.1 / 112.9 | 1.02 / 1.00 / 1.01 | 1.25 / 1.23 / 1.24 | 1.29 / 1.24 / 1.27 | 73 / 8 / 4 / 74 |

### 4. Endless survival census (`run/archer.survival --census`)

**The bot** (`survivalBot.ts`): an honest solo endless run, no god mode, no debug hits, recorded by endlessBot.ts's
`Driver` (its flask at <= 3 half hearts and Ember at <= 2). Config through the real path:
`buildEndlessRunConfig(seed, 1, { characters: [who] })` (Knight, Archer), `buildEndlessRunConfig(seed, 1)` for Both
(both weapons, no traits). Per floor: every room with planned spawns but the boss room, nearest first by BFS: walk in
(`Driver.walkTo`, the open stairwell avoided) until the room's score record engages, fight it with the fighter (target:
the nearest living member, else the nearest actor within 14; sight through the bullet blocker, BFS paths) until it
clears (cap 120 s); on a boss floor walk to the boss and fight her / him and the adds (cap 420 s, never J); walk onto
the stairwell (a floor not left in 4000 ticks is debug-skipped and counted: none was); the draft resolved with
buildOffers.ts's greedy pick. Shrines, pacts, pedestals, chests, pellets ignored. **Sample: run seeds 1-12 per
character (the same floors for each), to floor 20; 307 s** (Knight 48 s, Archer 206 s, Both 52 s).

| character | floor reached mean / median | alive entering f2 / f5 / f6 / f10 / f11 / f15 / f16 | deaths in room / boss / walk | hits per room f1-4 / f5-9 / f10-14 / f15-20 (rooms) | s per room f1-4 / f5-9 / f10-14 | boss fights killed / fought, s per fight | rolls / guards / heavy arrows |
|---|---|---|---|---|---|---|---|
| Knight | 3.3 / 3.5 | 10 / 6 / 0 / 0 / 0 / 0 / 0 | 7 / 5 / 0 | 0.40 (245) / 0.74 (34) / - / - | 5.5 / 5.4 / - | 0 / 5, 5.3 s | 28 / 168 / 0 |
| Archer | 8.5 / 8.5 | 12 / 12 / 7 / 6 / 2 / 2 / 0 | 1 / 8 / 3 | 0.04 (362) / 0.36 (292) / 0.58 (118) / 0.43 (14) | 6.3 / 13.7 / 16.3 | 9 / 17, 59.0 s | 2147 / 0 / 6918 |
| Both (old player) | 4.6 / 5.0 | 12 / 9 / 0 / 0 / 0 / 0 / 0 | 3 / 9 / 0 | 0.30 (347) / 0.61 (49) / - / - | 4.3 / 5.1 / - | 0 / 9, 4.7 s | 89 / 74 / 0 |

**Read with care: the census measures the bots.** The melee policy (walk in, swing, guard bullets) cannot read a boss's
melee telegraphs, so every melee boss fight (Knight 5, Both 9) ended in the bot's death within about 5 s; the Archer's kiting stays out of the bosses' reach and killed 9 of 17. So the Knight / Both floors
reached are the melee bot's ceiling (the first boss), not the Knight's; the useful comparisons are the room columns
(same rooms, same seeds): the Archer takes **0.04 / 0.36 hits per room** on floors 1-4 / 5-9 against the Knight's 0.40 /
0.74 and the old player's 0.30 / 0.61, and spends 6.3 / 13.7 s per room against 5.5 / 5.4 (Knight) and 4.3 / 5.1 (Both).

### 5. The Archer's roll

**Same policy, only the roll differs** (`sim/archer.roll.hold`: LG7's rooms at floor 6, the "roll-hold" bot kites and
rolls into every volley, never attacks: weapon-free; seeds 1-5, 20 s per room). Hits per minute, Knight's roll (2.5
tiles, 12 i-frames) / Archer's roll (3.38 tiles, 15 i-frames), and the Knight's own guard ("guard-hold": the guard on
every near bullet, never a roll):

| room | roll-hold Knight / Archer | with Slippery I: Knight / Archer | guard-hold Knight | Bastion: bullets counted per roll Knight / Archer | Bastion braces per room: roll Knight / Archer; guard Knight |
|---|---|---|---|---|---|
| 2 turret.caster | 51.6 / 38.4 (-26 %) | 49.8 / **4.2** | 28.8 | 2.0 / 1.6 | 0.8 / 0.6; 0.8 |
| 2 turret.sprayer | 18.0 / 18.6 (+3 %) | 12.0 / 12.6 | 16.8 | 1.1 / 1.6 | 0.0 / 0.8; 0.0 |
| 4 sniper | 7.2 / 4.2 (-42 %) | 5.4 / 1.8 | 13.8 | 2.2 / 2.7 | 0.0 / 0.0; 0.2 |
| 2 reaper | 9.0 / 6.6 (-27 %) | 7.2 / 3.0 | 3.0 | 1.3 / 1.5 | 0.0 / 0.0; 0.0 |
| mixed f6 census | 3.0 / 4.2 (+40 %, 1.0 / 1.4 hits) | 3.0 / 1.8 | 8.4 | 1.7 / 1.8 | 0.0 / 0.0; 0.2 |

Rolls per room: about the same for both (caster 48 / 44, sprayer 22 / 31, sniper 12 / 12, reaper 7 / 5, mixed 10 / 9).
With Bastion + Warding I + Citadel the roll braces are Knight 0.8 / 0 / 0 / 0 / 0, Archer 0.6 / 1.0 / 0 / 0 / 0 per
room (the guard: 1.4 / 0 / 0.2 / 0 / 0.2). **Slippery I on the Archer:** 12 x 187.5 % = 23 i-frames, longer than the
whole 21-tick roll, so a roll-spamming Archer is never hit while rolling: the caster room drops from 38.4 to 4.2 hits /
min (-89 %), the Knight's Slippery I (18 i-frames) from 51.6 to 49.8 (-3 %).

**While fighting** (`sim/archer.roll.fight`: LG7's fighting "roll" bot, the bow's stream, as the Archer and as the bow
with the Knight's roll; no build): hits / min caster 42.0 / 48.6, sprayer 11.4 / 15.6, sniper 2.4 / 3.6, reaper 7.3 /
9.1, mixed 0.0 / 1.1 (Archer / Knight's roll): 14-33 % fewer. Bastion's counted bullets per roll 1.0-2.1 (Archer) /
0.9-2.0 (Knight's roll); braces per room 0.4 / 0.2 (caster, sprayer) against 0.8 / 0 with the Knight's roll.

**What rides the roll** (open ground, one roll along +X):

| character | roll | Blazing Trail: embers, first to last, gaps min / max | Wrecker I: crates on the line at 1-6 tiles broken / farthest | a single crate at 1 / 2 / 3 / 4 / 5 tiles |
|---|---|---|---|---|
| Knight | 2.50 tiles | 6, 1.70 tiles, 0.10 / 0.55 | 3 / 3 | yes / yes / yes / no / no |
| Archer | 3.38 tiles | 6, 2.29 tiles (+35 %), 0.10 / 0.77 | 4 / 4 | yes / yes / yes / yes / no |

### 6. Offers per character pool (`run/archer.offers`: 1000 simulated runs per policy and pool, by floor 11)

"Both weapons" is the old two-weapon pool (every boon, no mask); Knight 18 boons / 16 duos, Archer 19 / 17.

| pool | policy | runs with >= 1 evolution | runs with >= 1 duo | mean evolutions | mean duos | mean legendaries owned | Greed pool empty / mean size | boss-draft duo available f5 / f10 |
|---|---|---|---|---|---|---|---|---|
| both weapons | greedy | 100.0 % | 51.6 % | 3.38 | 0.60 | 0.42 | 0.0 % / 3.99 | 9.3 % / 19.9 % |
| Knight | greedy | 100.0 % | 54.2 % | 3.34 | 0.62 | 0.41 | 0.1 % / 4.05 | 10.6 % / 20.1 % |
| Archer | greedy | 100.0 % | 50.8 % | 3.37 | 0.59 | 0.43 | 0.0 % / 4.00 | 9.1 % / 19.7 % |
| both weapons | random | 96.8 % | 54.3 % | 2.22 | 0.67 | 0.51 | 0.0 % / 5.32 | 16.6 % / 41.9 % |
| Knight | random | 96.7 % | 58.7 % | 2.21 | 0.73 | 0.49 | 0.0 % / 5.40 | 19.8 % / 42.6 % |
| Archer | random | 96.9 % | 54.6 % | 2.21 | 0.68 | 0.52 | 0.0 % / 5.32 | 17.0 % / 41.4 % |
| both weapons | duo-seeking | 99.8 % | 96.8 % | 2.69 | 1.80 | 0.52 | 0.0 % / 4.15 | 28.3 % / 31.6 % |
| Knight | duo-seeking | 99.9 % | 98.3 % | 2.71 | 1.81 | 0.45 | 0.0 % / 4.16 | 32.5 % / 32.7 % |
| Archer | duo-seeking | 99.9 % | 96.8 % | 2.69 | 1.80 | 0.49 | 0.0 % / 4.19 | 29.2 % / 32.9 % |

By floor 6 the pools are within a point of each other (greedy duos 11.2 / 12.1 / 10.9 %). Greed's deal holds a new
legendary in 97-100 % of deals for every pool. **Relics:** pools both weapons 4 (Mirror Cloak, Hourglass, Vampire Fang,
Second Wind), Knight 4, Archer 3 (no Mirror Cloak). Relic sources on real floors (pedestals + Rare vaults; solo runs
1-20, floors 1-10): 1.65 / 3.40 / 5.20 / 8.65 / 17.50 by the end of floor 1 / 2 / 3 / 5 / 10, so a player who takes
every relic empties a 3-relic pool by floor 3 in 100 % of runs and a 4-relic pool in 95 % (median floor 2 for both);
after that pedestals stay inert and a Rare vault pays its 2-boost fallback.

### Readings

- **The Knight is the old player in melee rooms, slower where the old player shot instead** (Knight x Both):
  pack, bruiser, Ooze, bomber, Warbanner room 1.00-1.20; snipers 1.05-1.34, imps 1.16-1.56, summoner 1.15-1.80,
  stormcallers 1.17-1.26, chargers 1.05-1.42, reapers 0.93-2.46 (f2), the census rooms 1.01-1.24, bosses 0.99-1.02. The
  gap is largest on shallow floors (where the walk-in is most of the fight) and shrinks with hp: by f20 it is 0-17 %.
  The bot's swap player mostly held the sword, so "Both" is close to the Knight by construction; the true old player
  could only be faster.
- **The Archer is slower everywhere a body comes close, and much safer.** Rooms by kind mostly 1.1-3.3x the old player
  (pack 2.3-3.2x, bombers up to 6.3x at f20, Warbanner room 1.9-2.4x, census rooms 1.9-2.5x from f6), faster only against
  snipers at f2 (0.80) and the caster turrets; bosses 1.13-1.32x (the cap binds the Knight, not the Archer's ~8 dps
  charge chain minus kiting). In god mode the Archer takes 0-12 hits / min where the Knight takes 40-79 (pack, bruiser,
  Ooze, bomber): the trade the design wants, measured. In the survival census that trade is decisive for the bots: the
  Archer reaches floor 8.5 on average (2 of 12 runs alive at floor 15), the melee bots die at the first boss.
- **Charged shots carry the Archer.** Holding ALT to full charge and releasing back to back is 5 damage every 37 ticks
  (~8.1 dps, piercing, aim-assisted) against the stream's 5 dps; the charge bot beats the stream bot in 10 of 11 endless
  kinds at f20 (up to 2.4x in Ooze rooms) and on both bosses; only imps (blinking) favour the stream. A player who only
  streams is 1.2-9.7x slower than the old player.
- **The longer roll is worth 14-42 % fewer hits in bullet rooms** under the same policy (casters -26 %, snipers -42 %,
  reapers -27 %; the sprayer and the mixed room are a wash at 1-1.4 hits a room). Bastion's roll braces: about as rare
  as the Knight's roll's (0-1 a room; only the turret rooms carry 8 bullets into one roll), a little more often in the
  sprayer room (0.8 vs 0). The Knight's guard is his better defence in turret rooms (28.8 vs the roll's 51.6 hits / min
  vs casters) and worse against snipers (13.8 vs 7.2). **Slippery I makes the Archer's roll a full-length i-frame
  window** (23 >= 21 ticks): the measured outlier.
- **What rides the roll:** Blazing Trail lays its 6 embers over 2.29 tiles instead of 1.70 (+35 %, the same count, wider
  gaps up to 0.77); Wrecker breaks one more crate on a line (4 vs 3) and reaches a lone crate 4 tiles out (AR3's spec).
- **Pools barely move offers.** Duos by floor 11 within -0.8 / +4.4 points of the old pool (the Knight's 16-duo pool is
  slightly MORE generous: fewer partners to dilute), evolutions within 0.04, legendaries within 0.07; Greed's pool is
  never empty by floor 11 (<= 0.1 %). Relics are the one pool the cut is felt in: every pool empties by floor 2-3 for a
  relic-taker, the Archer's one relic sooner.

### Recommendations (owner calls; nothing changed here)

1. **Archer clear speed** (the measured gap: rooms mostly 1.4-3.3x, census rooms ~2x, bosses ~1.25x the old player). Options:
   (a) accept: the Archer clears slower but takes 2-10x fewer hits per room and survives deeper (survival census), which
   is the character's identity; (b) a stream buff, e.g. `BOW_DATA.streamTicks` 12 -> 10 (6 dps: the stream-only player stops
   being the trap it is, x 1.2 on every stream row; affects M1's bow too unless made a trait); (c) an
   Archer trait `damagePercent` (a second per-character stat, ARD10's open door) of 115-125 %; (d) teach the charge
   (the bot's back-to-back charge is ~60 % more dps than the stream; a tutorial / codex line rather than a number).
   Suggested: (a) + (d), revisit with a playtest (AR14); if players stream, (b).
2. **Knight against ranged rooms** (slower than the old player on floors 6-20: snipers 5-16 %, imps 16-36 %, the
   summoner 15-33 %, stormcallers 17-19 %, reapers about equal; up to 80 % on floor 2). Options: (a) accept (no room is more than 1.4x past floor 2, bosses equal);
   (b) a Knight tool: a ranged finisher (Flurry's crescent at level I), or a longer lunge on the finisher; (c) a +10 %
   Knight walk speed trait. Suggested: (a).
3. **Archer + Slippery** (the measured outlier). The Archer's 125 % folds with Slippery I into 23 i-frames, longer than
   the 21-tick roll, and a roll can follow a roll at once: roll-spam is untouchable (-89 % hits in a caster room). The
   Knight reaches the same full-roll window only at Slippery II / III (21 / 24). Options: (a) cap `rollIframeTicks` at
   `ROLL_TICKS - 1` (20) for everyone (changes Knight Slippery II / III and Archer Slippery I-III to 20: a 1-tick gap
   per roll); (b) the larger of the two percents instead of their product for the Archer (Slippery I-III 18 / 21 / 24
   like the Knight, 15 without Slippery); (c) accept, Slippery as the Archer's signature pick. Suggested: (b) if the
   Knight's Slippery III is meant to be the full window, else (a).
4. **Bastion's roll brace: no change.** The longer roll does not make roll braces common (0-1 a room either way); the
   Risks section's worry is not borne out at `BASTION_BRACE_BULLETS` 8.
5. **Pools and offers: no change.** No duo / evolution / legendary / Greed number moves by more than 4.4 points.
   Relics: the Archer's 3-relic pool empties a floor sooner; if that matters, an Archer-side relic is the lever (out of
   scope per this plan: new items).
6. **Melee survival is unmeasured** (the bot's limit, not a finding): before any Knight buff, AR14's playtest should
   check the first boss as the Knight; a boss-telegraph-aware melee bot is the harness work that would close this.

**Not measured.** Party play, the Daily, real floor geometry for TTK (arena fights; the survival census is the real-floor
measure), relics, curses and boosts in the arena fights, human aiming and dodging (the bots' policies above), the melee
characters' boss survival (see 6), Riposte's counter-waves in a fight that guards often (the arena Knight guards only
when a bullet is near, so Counterstrike rows equal no build in bullet-free fights).

## Integration (2026-11-09)

The task branches were merged into `archer` in build order (AR0-AR4, AR12, AR6, AR5, AR9-AR11, AR7-AR8, AR13) with
`main` @ `49a7485` (Stage assets: playable while loading; new floor tiles), then the branch was rebased onto that `main`
as one linear series of task commits (no merge commits; the rebased tree is byte-identical to the merged one), and
rebased again onto `main` @ `3f7ce65` (frame pacing: the measured input lead; no conflicts; typecheck, lint, the checks,
build and shared/lockstep, run/runSessions, lobby, shared/theme, run/validate / segments / endless / party, sim/party,
view/hud, view/menu, shared/play: 146 suites, 2182 tests pass). Conflicts resolved:
`ActorRenderController` (main's lazily built player bodies and stand-ins now build each player's own visual:
`PlayerView.visualId`, `usePlayerBody` and the per-frame art readiness per visual), `RunOverPanel` imports,
`shared/run` barrel, CLAUDE.md. Main's stage manifest took a `characters` list with "the Archer planned": StageController
now passes the run's visuals (`shared/view` `stageCharacters(ctx.characters)`; no roster = `STAGE_CHARACTERS`, the
Knight's), and `run/stageInput.spec` no longer expects combat E's turret sniper on tutorial floor 1 (AR6).

Checked on the merged tree: typecheck, lint, check:assets, check:autolocalize, test:art (273 pass, 5 skipped: vendor
packs not in the cloud box), test:checks, test:l10n, build, l10n:check; headless Lune over shared/characters,
sim/progression, sim/builds/cards, sim/oneWeapon, sim/player, sim/runPlayer, sim/runFull, sim/runBoss, sim/runBullets,
sim/constants, sim/hash, sim/determinism, sim/combat.determinism, sim/swordBow, sim/weapons, sim/party,
sim/recordingCodec, run/config, run/endless, run/dev, run/party, run/validate, run/segments, run/tutorial,
run/runSessions, run/characterRuns, run/characterOffers, run/stage*, shared/tutorial, onboarding, lobby, settings,
shared/theme, shared/view, shared/play, leaderboard, shared/daily: 293 suites, 4171 tests, one failure (the stage spec
above, fixed and re-run with view/characters and view/stage*: 7 suites, 78 tests pass). Not run on the merged tree: the
full unfiltered suite (about 16 hours on this 2-core box), the dungeon / sim censuses and AR13's tuning specs (each
task ran its own before the merge); the known platform failure `dungeon/forge/forge.spec.ts` "EncounterRng is the
sim's new Rng(seed)" (NaN sign bit) is unchanged.

## AR12 upload (2026-11-09)

The owner uploaded the 14 `art/upload/ranger-*.png` (the seven sheets and their `-outline.png` rims, built by
`build-atlases.js --only class.ranger` and checked byte-identical to the lock) and their IDs are in
`packs/vale/assetIds.ts`: the bundled vale pack now draws `class.ranger` as the Archer's sprite set with both bow
animations (`attack.1` stream, `attack.2` charged shot) and the player rim. `vale.spec` now pins the bundled set (every
sheet and rim has an ID; animations `attack.1`, `attack.2`, `death`, `hit`, `idle`, `roll`, `run`) and still checks that
a missing core sheet falls back to the placeholder. Studio item 5 (the Archer's own sprite and outline, the roll
animation over the longer roll) is the next check.
