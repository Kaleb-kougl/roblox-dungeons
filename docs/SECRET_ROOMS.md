# Secret rooms: a cracked wall, and what's behind it

Status (2026-11-13): **SR0-SR5 built on branch `secret-rooms` (Track A: dungeon and sim, "As built" below); SR10 /
SR11 / SRD12 (Track T: theme, art, Codex entry); SR6 and the pure parts of SR7-SR9 (Track V1: shared/view, "As built
(Track V1)"); the client controllers (Track V2) and SR12-SR16 pending. Every decision answered by the owner (SRD1-SRD14, 2026-11-13):** a
flat 25 % of floors, four openers (the Knight's combo finisher, the heavy arrow, the Wrecker roll, a Charger), crack +
dust and nothing else before it opens, a first-time card, the chest (Rare 65 / Legendary 35), points on the open and
from the chest, the recap highlight plus one Codex entry (see "Decisions"). Planned against `main` @ `c0a8de2` (the Codex merged; floor
modifiers, the Goldling rumours, builds v2, the Archer and treasure rooms all in). Work it task by task like `PLAN.md`;
each task ends with a **Verify**. Project copy: `claude/secret-rooms-plan.md`. Related: docs/TREASURE.md (the chest,
its grants and art), docs/BUILDS_V2.md (Wrecker's roll smash, Ballista / Siege Bolt), docs/ARCHER.md (the heavy arrow
is the Archer's), docs/NEW_ENEMIES.md (the Charger), docs/DECOR.md (breakables, solid decor, far walls),
docs/VOID_DECOR.md (the rock that hides the chamber), docs/MINIMAP.md (fog), docs/GOLDLING_RUMOURS.md (the other
"find it" feature: that one is announced, this one is not).

Goal: some walls are **not walls**. Somewhere on a floor, one stretch of a room's far wall is cracked: hairline
fractures, a little dust trickling from the joints. Hit it with your sword and it sounds hollow. Nothing tells you it
is there, no chip, no card, no map mark. Break it the right way and the wall bursts open on a small torch-lit chamber
with a chest in it, a discovery jingle plays, and **SECRET!** stamps on the floor.

Four things can break it, each something the game already has (SRD2 / SRD3):

| Opener | Who has it | How it breaks the wall |
|---|---|---|
| **Sword finisher** | The Knight (docs/ARCHER.md: Knight = sword) | The combo's third hit (the lunging finisher) whose arc reaches the crack. Swings 1 and 2 only knock; the guard does nothing |
| **Heavy arrow** | The Archer (the bow's charged shot, docs/ARCHER.md) | A heavy arrow that stops on the crack (Siege Bolt's slam counts: it is the heavy arrow's end) |
| **Wrecker roll** | Anyone who took Wrecker (common boon, docs/BUILDS_V2.md) | A Wrecker owner's roll that touches the crack |
| **Charger** | The enemy (docs/NEW_ENEMIES.md), when one lives in that room | Its charge reaching the crack: stand in front of it, let the Charger lock its lane on you, roll aside |

Both characters get the same shape of puzzle: the ordinary attack only knocks, the heavy one opens. The Knight's first
two swings knock, so he has to carry the combo through to its third hit, the finisher. The Archer's stream arrows
knock, so she needs a charged shot, a Charger she baits into the wall, or Wrecker. Either way the hard part is the same for everyone:
**noticing the crack**.

The hook is the "wait, what?" moment, so the rules are built to keep it honest: a crack **always** hides a room, the
room **always** pays, and missing it costs nothing.

**Sim impact: gameplay, opt-in, endless only.** Floor-built placement (shared/dungeon, its own stream, run LAST in
`buildEndlessFloor`, so every earlier floor output keeps its value and slot), a new inert breakable kind for the
cracked wall (blocks bodies and bullets like the vault's chest), four opener hooks, and opt-in `SimConfig.secrets`
with its own hash group `secrets` appended LAST (after `golden`) and its own rng word for the chest. M1, every golden
fixture and the tutorial replay exactly as before; endless / daily / dev replays and scores change (boards stay
`_v1`, `DAILY.ruleset` 18 -> 19).

## As built (branch `secret-rooms`, Track A: dungeon and sim)

### SR1: placement (`shared/dungeon/secrets.ts`, `secretsData.ts`)

- `SECRET` (salt `0x4b565343`, fromFloor 2, chancePercent 25, roomTypes combat / elite, crackCells 2, frontDepth 3,
  chambers 5x4 / 4x4 / 4x3 / 3x3, tierWeights Rare 65 / Legendary 35, doorClearTiles 2, wallPropClearTiles 1,
  poolClearTiles 1), `CRACKED_WALL_KIND` = `"crackedWall"` appended to `BREAKABLE_PIECE_KINDS` (index 3).
- `secretCandidates(input)` (pure; room id, then the crack's first cell in row order, then facing (1, 0), (0, 1); one
  candidate per crack position with its largest chamber), `placeSecret(input, floor, override?)` (0 / 1 / 3 draws),
  `carveSecret(d, plan)`, `secretPieces(plan)`, `secretCrackCells`, `secretChestCentre`, `secretSeed`; `FloorSecret`
  carries the crack (`x`, `y`, `fx`, `fz`, `ax`, `az`, `cells`), the chamber rectangle (`x0`, `y0`, `w`, `h`, `along`,
  `depth`), the chest (`chestX`, `chestY`, faces `fx`, `fz`), `tier`, `crackSlot` / `chestSlot` and the carved `dungeon`.
  `SecretOverride` (`every`, `tier`) like `VaultOverride`.
- `buildEndlessFloor` runs it last when `EndlessFloorOptions.secrets` is set (`secretOverride` with it), appends the
  crack pieces then the chest after the Goldling's piece, and keeps `roomSpawnTiles` from the list without them (no
  spawn tile can hold either). `EndlessFloorLayout.secret`.
- Rules the plan left open, decided in SR1: the crack cells must be **outer** walls (`roomId` -1, no solid decor), the
  wall props kept clear are Forge torches and any Forge prop standing on an outer wall cell (banners, wall-top graves),
  doorway arches are covered by the doorway test (they frame doorway cells); the chamber starts
  `floor((along - 2) / 2)` cells before the crack's first cell; the halo is checked over `k = 0 .. depth + 2` (the
  wall line and behind it), and the row in front of the wall line holds no corridor / doorway over `i = -1 .. along`
  and no solid decor over the chamber's own columns (a bookcase's back must never stand over the chamber's floor);
  the chest is on the back row at along index `floor((along - 1) / 2)`; the front box keeps the clutter's clearances
  for the entrance, stairwell, pedestal, shrine and pact altars (moot in combat / elite rooms, kept for safety). The
  vault chest's front box moved from golden.ts into vault.ts as `vaultFrontCells` (same cells, same order).
- secrets.spec.ts: the tunables, the piece kind, the salt against every floor and sim salt, a hand twin of the draws,
  the override, every rule above on every secret of runs 1-4 x floors 1-9 (with `every`), the carved grid's diff, the
  pieces' slots, and the option off / a floor without a secret equal to the option-off floor (solo and party 3).

### SR1 census (`secrets.census.<n>.spec.ts`, `--census`; runs 1-60 x floors 2-30, solo and party 3)

Four shards of 15 run seeds (about 50 s each, only chance hits are built). Sums of the `[secrets:raw]` lines:

| Floors | Floors | Chance hits | Hits with no candidate | Secret floors | Candidates per hit (max) |
|---|---|---|---|---|---|
| 2-4 | 180 | 43 (23.9 %) | 4 (9 %) | 39 (21.7 %) | 4.7 (16) |
| 5-9 | 300 | 74 (24.7 %) | 7 (9 %) | 67 (22.3 %) | 5.7 (18) |
| 10-19 | 600 | 140 (23.3 %) | 16 (11 %) | 124 (20.7 %) | 4.8 (18) |
| 20-30 | 660 | 169 (25.6 %) | 23 (14 %) | 146 (22.1 %) | 5.5 (27) |
| **all, solo** | 1740 | 426 (24.5 %) | 50 (11.7 %) | **376 (21.6 %)** | |
| all, party 3 | 1740 | 426 (24.5 %) | 47 (11.0 %) | 379 (21.8 %) | |

- **The real rate is 21.6 % of floors** (SRD1's 25 % less the 11.7 % of hits with no candidate): close to the plan, so
  no rule changed. Deep floors fit slightly worse (9 % of hits empty on floors 2-9, 14 % on 20-30: more rooms, more
  corridors in the void) but the secret rate holds (20.7-22.3 % per band).
- Chamber sizes (solo): 5x4 145, 4x4 72, 4x3 55, 3x3 104 (party 3: 153 / 68 / 52 / 106): most cracks get the largest.
- Tiers (solo): Rare 254 / Legendary 122 (67.6 / 32.4 %, against 65 / 35). Facings: (1, 0) 207, (0, 1) 169.
- Boss floors with a secret: 75 (never the boss room). Crack rooms that are elite: 29 of 376.
- **Crack rooms with a planned Charger** (the Archer's third key): 189 of 376 solo (50.3 %), 136 of 379 in a party of 3
  (35.9 %: the party's bigger budgets buy dearer kinds).

### SR2: the inert kind and the knocks (`sim/breakables`)

- `BreakableKind.CRACKED_WALL` 3, `CRACKED_WALL_HP` 1 (fixed, hashed), `inertPiece(kind)` (chest or crack).
  `damageBreakable` returns before any bookkeeping for an inert piece; for a crack it first reports a **knock**.
- **Knocks** (unhashed, per tick, cleared with `hitSlots`, copied by clone): `BreakablesState.knockSlots`,
  `knockSources` (BreakableSource of the contact) and `knockPlayers` (the player behind it, -1 for enemy bullets,
  slams, a Bomber's blast, a Charger). Every contact that reaches `damageBreakable` is one knock: player and enemy
  bullets, the sword's melee pass (swings 1 and 2), slams (the boss's, a Bomber's, a Charger's radius), Demolition and
  Siege's shock (their loops keep the chest-only skip on purpose). The guard, novas and Riposte waves never reach a
  piece, so they never knock. A roll without Wrecker touches no piece.
- `shared/sim/testing` `secretArena.ts`: a hand-built carved room with a crack, chamber and chest (`ARENA`,
  `arenaConfig`, `arenaWorld`, `arenaSecret`) for the sim specs. `sim/breakables/crack.spec.ts`.

### SR3 / SR4: the openers, the state, the chest (`sim/secrets/`)

One commit for both (SR0: the openers need the state). Modules: `secretsData.ts` (`SecretsConfig`, `SECRETS_CONFIG`
= the vault's reach / points / boosts plus `openPoints` `SECRET_POINTS` 600, `SECRETS_SALT` 0x4b565352, `SecretStatus`
NONE / HIDDEN / OPEN / TAKEN, `SecretHow` FINISHER 0 / ROLL 1 / HEAVY 2 / CHARGER 3), `secrets.ts` (state, floor fill,
clone, hash, `secretsRunSummary`), `open.ts` (the openers), `stepSecrets.ts` (the chest).

- **Openers:** `secretsOpenPiece(state, slot, how, player)` from `meleeHitBreakables`' new trailing `finisher` flag
  (passed only by `sweepArc`'s new trailing `finisher`, which only the sword's finisher call sets), from
  `rollSmashBreakables` (a crack in reach opens instead of breaking; the roll smash is only called with Wrecker), and
  from `playerBulletHit`'s piece branch (a crack + `isHeavyArrow`; Ballista's burst back as from a wall);
  `secretsSlamAt(state, x, z, owner)` from Siege Bolt's slam (the slam point's cell or a 4-neighbour, before the shock's
  pieces); `secretsChargeAt(state, x, z, r)` from the Charger's charge tick, **before** `slamBreakables` (SR0). A heavy
  arrow carrying a pinned body usually reaches the crack itself first: HEAVY either way.
- **The open** breaks every crack piece that tick (hp 0, `brokenTick`, out of `slotByCell`, `intact` down) with no
  breakables bookkeeping (no `breakablesBroken` / `brokenSlots`, breakable points, loot, smash proc or Goldling
  release), HIDDEN -> OPEN, `openTick`, `openedBy` (the credited player; -1 for a Charger), `openHow`, `found`,
  `byHow[how]`, and pays `scoreSecret(secretOpenAwardPoints(600))`: floor(600 x floorScalePercent x Depth x (4 +
  curses) / (4 x 100)), the combo fixed at x1.0.
- **The chest** (`stepSecrets`, after `stepGolden` in `step` and `stepParty`): OPEN -> TAKEN when the first living
  present player is within `reachTiles` (1.5) of its centre; the shares are the vault's grant core, lifted unchanged
  into `sim/treasure/grants.ts` (`grantShares(state, rng, origin, tier, config, bonusDeals)`, `livingPresent`;
  stepTreasure's `openChest` now calls it with the treasure state as stream and origin), drawn from the secrets' own
  stream; a Legendary's bonus deal goes into `state.treasure.bonusDeals` (none without treasure or builds: the relic);
  the chest's treasure points (`treasureAwardPoints(points[tier])`) into SECRET.
- **Score:** `ScoreSource.SECRET` 16, `SECRET_SCORE_SOURCE_NAMES` `["secret"]`, `addSecretScoreSources` padded last in
  createSimState (after OVERCAP): every endless run holds 17 sources.
- **State and hash** (`secrets` group, appended after `golden`, last): `rngState`, `status`, `room`, `crackSlot`,
  `cells`, `chestSlot`, `crackX`, `crackY`, `ax`, `az`, `x`, `z` (the chest's world centre), `fx`, `fz`, `tier`,
  `openTick`, `openedBy`, `openHow`, `takenBy`, `found`, `taken`, then `byHow` (length + 4 values).
  `EndlessFloorWorld.secret` (the plan); `secretsOnFloor` from createSimState and the floor change (after the Goldling)
  checks the plan's slots against the pieces.
- **Events for the view** (`SecretsState.events`, per tick, unhashed): `opened?: { tick, how, player (credited, -1
  for a Charger), finder (the toast's player: the credited one, or the nearest living present player for a Charger),
  slot (the crack's first slot), x, z (the crack's centre, world), points }`, `taken?: { opener, tier, points, grants:
  TreasureGrant[] }`. Knocks: the breakables' feed above. Run counters: `secretsRunSummary(state)` -> `{ found, taken,
  byHow }`.
- Specs: `sim/secrets/openers.spec.ts` (every opener and non-opener of SR3's Verify but Thunder Guard's sparks, which are
  bullets of their own kind and knock like any non-heavy bullet), `sim/secrets/secrets.spec.ts` (SR4's Verify).

### SR5: the run configs (`shared/run`)

- `buildEndlessRunConfig` sets `secrets: SECRETS_CONFIG` (solo and co-op), so endless, the Daily and dev have it (and the
  server's registry and validator, which build through it); M1 and the tutorial do not. `endlessRunFloor` builds every
  floor with `secrets: true` (and the dev world's `secretOverride`); `endlessFloorWorld` builds its five movers and
  blockers on `layout.secret?.dungeon ?? layout.dungeon` and passes `secret` to the sim world; `roomIdAt` and
  `EndlessRunFloor.dungeon` stay the Forge's. `DAILY.ruleset` 18 -> 19.
- Dev: `SECRET_DEBUG_ATTRIBUTE` `KV_SecretDebug`, `parseSecretDebug` (`every`, `legendary` / `rare`),
  `DevRunOptions.secret`, `EndlessRunOptions.secretOverride`. **Client wiring pending (view track):**
  `DevModeController` must read the attribute and pass `secret` like `vault`.
- `run/stageInput.ts` counts only `BREAKABLE_KINDS` as clutter (SR0).
- `run/secrets.spec.ts`: the configs, the carved movers, the dev override, and a recorded Knight run (run seed 16:
  debug skip to floor 2, walk to the crack at (94, 8), hold FIRE: two swings knock, the finisher opens it at tick 1265,
  take the 5 x 4 chamber's chest; 1331 ticks) that replays and validates on the server (debug input allowed).
- **Pins re-recorded** (only where a secret now stands): `sim/charger.spec` PIN_HASH e42f7fdf -> b44f15ea and
  `sim/stormcaller.spec`'s run 4 pin 3/0/0406aa34 -> 3/0/6b926521: run 4's floor 3 (solo) holds a secret (room 0, crack
  (44, 18)); their counts did not move; run 23's co-op floor 3 has none (its pin unchanged). The vault's specs and pins
  (`sim/treasure/*`, the vault census) pass unchanged; `run/endless.spec`'s recorded 7-floor run is unchanged.
- Structural specs updated for `secrets` as the last group and 17 score sources (or given `secrets: undefined` where
  they isolate an earlier group): run `endless` / `affixes` / `partyProgression` / `dev` / `tutorial`, sim `hash` /
  `breakables` / `builds` / `overcap` / `golden` / `payouts` / `pacts` / `pellets` / `progression` / `score` /
  `treasure`; `daily.spec`'s ruleset pin 19.

## What the code gives us (read in the source at c0a8de2; SR0, 2026-11-13: every row marked **read** or **corrected**, the client and Codex rows left to their tracks)

| Fact | Where | Consequence | SR0 |
|---|---|---|---|
| Forge walls are one cell thick: after carving, every VOID cell 8-touching FLOOR becomes WALL; the grid is the rooms' bounding box padded by `PADG` 5 | `dungeon/forge/generate.ts` (~l. 638, 745) | A chamber dug into the VOID behind a room's wall shares that wall line; its crack is those wall cells. At the grid's edge there are only 4 VOID cells behind a wall, so a chamber there is at most 3 deep (its back wall is the 4th). Interior void pockets can hold bigger ones. The grid is never resized | **read**: l. 638-642 (PADG 5), l. 745-757 (the VOID -> WALL pass over FLOOR's 8 neighbours; l. 826 is the same rule for later floor). SR1's census measures how deep the chambers really fit |
| A **far wall** is an outer WALL cell with its room's FLOOR at +X or +Z (`farWalls`, facing `fx` / `fz` = 1); bookcases, banners and wall-top decor use them | `view/decor/decorPlan.ts` ~l. 834 | Cracks go on far walls only: their front face is the one the 45 / 55 degree camera sees, and the chamber lies screen-up behind them, framed by the room | **read** (l. 832-856), with two details the crack keeps: an outer wall is WALL with `roomId` < 0 and not a solid pillar, and a back corner (WALL at +X and +Z) is no far wall |
| `buildEndlessFloor` builds, in order: Forge, encounter, roster, spawns, breakables, then `placeFloorParts` (affixes, loot, pellets, vault, altars, Goldling), the modifier pick and its forced re-run, then appends the Goldling's piece after every other piece | `dungeon/endless.ts` l. 681-750 | `placeSecret` runs after all of that and appends its pieces after the Goldling's: no earlier output, digest or piece slot moves; only floors that roll a secret change | **read** (l. 683-750) |
| The sim's movers and blockers are built from the layout's `Dungeon` in one place: `endlessFloorWorld` (`playerMover(d)`, `bulletBlocker(d)`, `bodyBlocker(d)`, `actorMover(d)`, `actorSteerMover(d)`) | `run/endless.ts` l. 169 | The sim gets a carved copy (`secret.dungeon`: a new `grid`, every other array shared) for those five; `layout.dungeon` stays the Forge's, so the whole view (world, void, decor, minimap) draws an unopened floor exactly as today | **read**. Also: `roomIdAt` stays on the Forge grid (a chamber cell is `roomId` -1 either way, so the answer is the same) and `EndlessRunFloor.dungeon` stays `layout.dungeon` (the client draws it). Other readers: BulletAhead (`prepare(state, world)`: `world.isBulletBlocked`) and local prediction (`predictMotion`'s `movePlayer(..., world)`) read the floor's SimConfig (`simWorldConfig`), so they get the carved movers with no change; `view/collisionDebug.ts` takes a `Dungeon` from the client (view track: pass the carved one); the bots' `pathField` / `bulletBlocker(w.dungeon)` (endlessBot, survivalBot, tutorialBot) and the recap's `stairsPathTiles` read the Forge grid: harmless (the crack is a wall there, the chamber a dead end), SR13's investigate bot needs the carved one. `bfs` / `maxBfs`: no reader outside `dungeon/forge/` (grep), so the carved copy shares them |
| Breakables block bodies and every bullet (`SolidCells`, `slotByCell`) but not sight; they are hashed per piece (`kind`, `x`, `y`, `hp`, `brokenTick`) in the `breakables` group. The vault's chest (`BreakableKind.CHEST` 2) is an inert piece: `damageBreakable` returns before any bookkeeping, every damage loop skips it, a bullet that reaches it still stops | `sim/breakables/breakables.ts`, `breakablesData.ts`; chest tests also in `builds/siege.ts`, `builds/smash.ts`, `treasure/treasure.ts`, `view/breakables.ts` | The cracked wall is a 4th piece kind, `CRACKED_WALL` 3, inert exactly like the chest (one helper `inertPiece(kind)` replaces every `kind === CHEST` test, byte-identical for kinds 0-2). Its open state is the piece's `brokenTick`: already hashed | **corrected**: the chest tests are `breakables.ts` (`piecesFrom` hp, `damageBreakable`, `rollSmashBreakables`, `meleeHitBreakables`, `slamBreakables`), `builds/siege.ts` (`breakPieces`), `builds/smash.ts` (Demolition), `treasure/treasure.ts` (`treasureOnFloor`'s identity check, which stays a chest test), `view/breakables.ts` `isChestPiece` (view track: a crack must not draw as a barrel), `view/decor/decorPlan.ts` l. 1080 `p.kind === "chest"` (view track), `run/stageInput.ts` `p.kind !== "chest"` (a crack would count as clutter needing breakable art: now `BREAKABLE_KINDS` only), `run/testing/snagCensus.ts` (builds `{ vaults: true }` only: unaffected); the sim's Goldling piece check (`golden.ts` l. 248), the pact altars and the flee mask read pieces placed before the secret or WALL-free masks: unaffected. Design change (smallest): the knock comes from `damageBreakable`'s early return, so the area loops that only break (`slamBreakables`, Demolition, Siege's shock) keep skipping the chest alone and let a crack reach `damageBreakable` (one knock, no damage); the melee pass and the roll smash test `inertPiece` and handle a crack inline (open or knock). Knocks are an unhashed per-tick feed on `BreakablesState` (`knockSlots` / `knockSources` / `knockPlayers`, beside `hitSlots`), so they exist without `state.secrets` |
| Sight passing a piece | `sim` sight / LOS, bow assist (`bowAssistAim`) | Harmless: the chamber is empty, so nothing on either side can use a line through an unopened crack. The minimap's sight is the view's and reads the uncarved grid (the crack is WALL there) | **read**: `SimCtx.lineOfSight` and `bowAssistAim` use `config.isBulletBlocked` (the carved grid; pieces never block sight), so a line passes an unopened crack into the empty chamber: harmless |
| Wrecker's roll smash (`rollSmashBreakables`, called only through `buildsRollSmash`, which checks the boon) tests the roll step's segment against each piece's circle (`PLAYER_RADIUS` + `hitRadius` 0.5) **before** the move | `sim/breakables/breakables.ts` l. 255 | A roll into the crack reaches it: the step points into the wall even though the move is then blocked (SR0 measures it head-on and at 45 degrees) | **corrected**: `PLAYER_RADIUS` is 0.35, so the reach is 0.85 (l. 255-285). A body resting on the face is exactly 0.85 from the cell centre and the test is strict, so standing still touches nothing; any roll step into the wall (head-on or at 45 degrees) brings the segment's nearest point closer and touches. SR3's specs roll into it both ways |
| The sword is a 3-hit combo: swings 1 and 2 (120 degree arcs), then a wind-up with a lunge and the finisher (180 degrees, reach 2.53 vs the swings' 1.955 in the port). Its melee pass `meleeHitBreakables` (from `sweepArc`, after the actors) hits every intact piece but a chest whose circle (0.5 round its cell centre) reaches into the arc, credited to the swinging player (`owner`); the finisher already has its own hook (`buildsOnFinisher`) | `combat/weapons/defs/sword.ts`, `sim/breakables/breakables.ts` l. 316 | The sword's crack hook needs to know the hit is the finisher: `meleeHitBreakables` gains an optional trailing `finisher` flag the sword passes (absent: byte-identical). A crack in a finisher's arc opens, in a swing's arc it knocks. SR0 lists every `sweepArc` / `meleeHitBreakables` caller: never the guard's erase arc, a Riposte counter-wave or another build effect | **read** (l. 183-226: swings 1.955 / cos 0.5, finisher 2.53 / cos 0). Every `sweepArc` caller: the sword's swings 1 / 2 and finisher (the only ones passing `breakableDamage`), the sword's guard, `testMelee` and the novas (`builds/evolutions.ts`: Overflowing / Bulwark), none with `breakableDamage`. `meleeHitBreakables` has one caller (`sweepArc`'s breakables pass). Riposte's counter-waves hit no breakable (`builds/riposte.ts`, BVD2); Flurry / Storm Blade are bullets and sparks. So `sweepArc` and `meleeHitBreakables` each gain a trailing `finisher` flag, passed only by the finisher |
| Heavy arrow: `isHeavyArrow(payload, vx, vz)` (kind PLAYER, the bow's source, the heavy speed); `playerBulletHit` asks the grid blocker, then the pieces; Ballista bursts on a piece that stopped it | `sim/builds/duos.ts` l. 161, `sim/combat/combat.ts` l. 538 | The crack hook sits on the piece branch: a heavy arrow stopped by a crack opens it (consumed like on a wall). It is aim-assisted toward an enemy within 10 degrees, so mid-fight it may veer: fine, the cleared room is the easy case | **read** (`playerBulletHit` l. 538, its piece branch l. 553-570). The grid blocker is asked first, so an arrow only reaches the piece branch if the crack's cells are FLOOR in the sim's grid: the carved copy is required, not optional |
| Charger: each charge tick calls `slamBreakables` at the step's midpoint with radius 0.5 (body) + 0.707 (`chargeBreakRadius`) + half the step (~0.09), then cuts the step to its room's floor box shrunk by its radius | `sim/combat/actors/archetypes/charger.ts` | Stopped at the box edge right in front of a far wall, the crack's cell centre is 1.0 away along the normal: inside 1.3 for a lateral offset under ~0.83, so a 2-cell crack catches charges over a ~3.6-tile band. The hook is one call next to `slamBreakables` (which itself must keep refusing the crack: the Bomber and the boss slam through it) | **corrected**: `chargeSpeed` 11 (a step of 0.183, h = half of it <= 0.092) and the slam only runs on a tick whose (box-cut) step is > 0. The step's midpoint is h before the box edge, so the crack centre is 1.0 + h away along the normal against a radius of 1.207 + h: a lateral offset under 0.68-0.70 of a crack cell's centre, so a 2-cell crack catches charges ending within a ~2.4-tile band (1 + 2 x 0.69), not 3.6. Rect and oct rooms: the far wall of a straight run is the room's extreme row (the box edge is the face); an ellipse's run too (a stepped run's chamber would overlap the parent's own wall cells, which SR1 refuses), and the plain mover stops the body 0.5 from the face anyway (the same 1.0 + h). Order: the opener runs just BEFORE `slamBreakables` (equivalent for every other piece), so an opening charge does not also knock |
| Treasure's open: a TreasureGrant per living present player (Rare: a relic from their unowned pool, else boosts; Legendary: a bonus deal on the next draft (builds runs) plus a boost; Common: boosts), boosts landed in front of the chest or given straight to the player, `scoreTreasure` | `sim/treasure/stepTreasure.ts` l. 155-254 | The secret chest reuses the same grants. The grant core is lifted into a shared function taking the rng holder, origin and facing (byte-identical for the vault: its specs and the vault pins). The bonus deal goes into `state.treasure.bonusDeals` (every endless world has `treasure`) | **read** (l. 147-254): the core reads the TreasureState as RngHolder (`pickBoostKind(t)`, `rngInt(t, ...)`), origin and facing `t.x` / `t.z` / `t.fx` / `t.fz`, `t.config`, `t.bonusDeals`; scoring (`scoreTreasure`) stays outside the lifted core |
| Gated score sources: JACKPOT 9 .. OVERCAP 15, each present only with its config, padding every earlier gated one | `sim/score/scoreData.ts` | `ScoreSource.SECRET` 16, only with `SimConfig.secrets` (`addSecretScoreSources`); every builds run then holds 17 sources | **read** |
| Hash groups end `..., pellets, treasure, pacts, golden` | `sim/hashLayout.ts` | `secrets` appended after `golden` | **read** (also `replay.ts` `writeHashFields`, l. 204) |
| WorldController merges each tile type into greedy rectangles; walls on textured biomes get 5 world-anchored Textures | `client/controllers/game/WorldController.ts` | The crack's cells are taken out of the wall merge and drawn as their own Part (same material and world-anchored texture, so no seam) plus a crack overlay; at the open it goes | read (l. 163 `greedyRectsOf`); the rest is the view track's (SR7) |
| VoidController builds the void as greedy-merged columns (shoulder / ledge / outcrop / abyss) from `planVoid` over the Forge grid; void set pieces stand behind far walls | `shared/view/voidDecor`, `VoidController` | Before the open the chamber IS void rock, exactly today's look. `planVoid` gains an optional hold-out rectangle so the chamber's columns are separate and can sink at the open; `planDecor` keeps void and wall-top pieces off the chamber and the crack | read (`planVoid`, `voidDecor/plan.ts` l. 119); the rest is the view track's (SR7) |
| Codex: 86 entries, ids `<category>:<key>`, an append-only order lock (`catalog.spec`), client-claimed seen / found; port audio IDs after `sfx.codex.new` must update `codex.spec`'s tail and the skips in the fortune / treasure / runRecap / boosts / audio / contract / floorModifiers specs; a first-time card id is either a Codex entry or pinned as none (like `golden.rumour`) | CLAUDE.md (Codex), docs/CODEX.md | SRD12 adds one entry `secret:room` (a new category, appended), claimed by the first-time card's moment (seen) and an open (found); SR10 updates the audio tail and skips | not read in SR0 (Track T, SR9 / SR10) |
| Roster: since DSD18 one seeded kind joins every floor, the full ten from floor 10; the Charger's caps are 2 per room | `dungeon/endlessData.ts`, docs/DAILY.md | Charger rooms exist on most floors past the first few: an Archer without a charged shot lined up can still bait one. With the sword opening (SRD3) no room is weighted toward them | **read** (`ROSTER.floorsPerKind` 1, `NEW_KIND_MAX_PER_ROOM.charger` 2) |

SR0's design changes, each the smallest that keeps the plan's intent:

- **Knocks** live on `BreakablesState` (`knockSlots` / `knockSources` / `knockPlayers`, per tick, unhashed, cleared with
  `hitSlots`), not on `state.secrets`: every damage path reaches `damageBreakable`, which exists without the secrets
  state. The area loops (`slamBreakables`, Demolition, Siege's shock) keep their chest-only skip so a crack reaches
  `damageBreakable`'s early return (one knock each); the melee pass and the roll smash use `inertPiece` and handle a
  crack inline.
- **The Charger's opener runs before `slamBreakables`**, not after (same result for every other piece; no knock on the
  opening tick).
- **`state.secrets` arrives with SR3**, not SR4: an opening writes its status, tick, opener and how.
- `run/stageInput.ts` counts clutter as `BREAKABLE_KINDS` (barrel / crate) instead of "not a chest", so a crack never
  asks for breakable art (byte-identical for every existing floor).
- The Charger's band is ~2.4 tiles, the roll smash's reach 0.85 (rows above).

## Player experience

| When | What you see | What you hear |
|---|---|---|
| A room with a cracked far wall | Two wall cells with a crack pattern across the face and top, slightly darker; every few seconds a thin dust trickle falls from the joints (`SECRET_VIEW.dustEverySec`, none under reduced motion) | Nothing |
| You hit it the wrong way (sword swings 1 and 2, a stream arrow, an enemy bullet, a barrel's splinters, a blast) | A puff of dust on the face, no damage | `sfx.secret.knock`: hollow, so the knock alone says "different" (SR0 checks what a plain wall hit sounds like today) |
| The first knock ever (per player) | A first-time card on the sighting slot (SRD5): *A hollow wall. A finishing blow, a Charger's charge or a Wrecker roll could break through.* The Archer's text (a per-character override, `bestiary.secret.crack.archer`) says *a charged arrow* instead of *a finishing blow*. A Knight usually sees it after his first swing at the wall, before his finisher lands | |
| A Knight's combo reaches its third hit on it | The finisher opens it (below) | |
| It breaks | The wall bursts into rubble (shards, dust, a `stamp` nudge, a 40 ms solo freeze); the rock behind it sinks over 0.5 s and the chamber appears: floor, its own walls, two torches, the chest at the back | `sfx.secret.open` (crumble), then `sfx.jingle.secret` on the reveal |
| | **SECRET!** floor shout at the opening (the combo shout's construction, priority above the combo, under goldenAppear); the minimap reveals the chamber with a chest mark | |
| Walk up to the chest | The vault's open: jolt, pop, light column in the tier's colour, reward cards (relic / bonus deal / boosts) | The treasure open and its tier sting |
| Run over | A recap highlight `Secrets found ×2` (team in co-op) | |
| A floor you left without finding it | Nothing. You never knew | |

- **Co-op:** one player opens it for everyone; everyone sees the same burst. The chest gives every living present
  player a share, as the vault does. A teammate's open far away shows the chamber on the shared map.
- **Daily:** the day's seed places the secrets, so everyone hunts the same cracked wall on floor 3. A talking point.
- **Muted / colour-blind:** the crack is a shape (lines on the face), not a hue; the knock's dust puff is visible.

## Rules

- **Worlds:** wherever `SimConfig.secrets` is set: endless solo / co-op, the Daily, dev. Never M1 or the tutorial.
- **Floors (SRD1, owner):** from floor `SECRET.fromFloor` 2; at most one secret per floor; one chance draw on the
  secret stream `EncounterRng(floorSeed ^ SECRET.salt)` (salt `0x4b565343`, "KVSC"; checked unique among the floor
  salts): `SECRET.chancePercent` 25 on every floor, no depth bands. Boss floors may roll one; the boss room never holds a
  crack.
- **Rooms:** combat and elite rooms (`SECRET.roomTypes`), never the entrance, boss, shrine or treasure rooms.
- **The crack:** `SECRET.crackCells` 2 adjacent far-wall cells of one room, on a straight run with at least one more
  WALL cell on each side (corners stay wall), each with its room's FLOOR right in front (+f) and VOID right behind (-f).
  Not on, or next to, a Forge torch; not within 2 of a doorway or arch; no POOL within 1.
- **The front box** (where you stand to open it): `crackCells` x `SECRET.frontDepth` 3 cells in front, all FLOOR in
  the same room, no piece (clutter, loot, the chest, the Goldling's), no solid decor (a bookcase run on that wall rules
  it out), no stairwell / pedestal / shrine / altar within their clearances, not in the vault chest's front box.
  Pellets may lie there.
- **The chamber:** a rectangle behind the crack, centred on it along the wall, tried largest first from
  `SECRET.chambers` (5 x 4, 4 x 4, 4 x 3, 3 x 3; along the wall x depth). Its floor cells are VOID in the Forge grid;
  its ring (back and side walls) is VOID or the parent's own wall line; one more cell round the ring holds no FLOOR,
  POOL, corridor or doorway cell (so the chamber never touches another room or corridor and has one way in). Inside
  the grid bounds.
- **Pick:** every candidate (room, crack position, chamber) is listed in room id / row order; ONE uniform draw picks
  one (no room weighting: the sword gives the Knight a key everywhere, SRD3). No candidate: no secret (the chance draw
  is still made).
- **The chest (SRD6, owner):** at the centre of the chamber's back wall row, facing the crack. Its tier is ONE draw on
  the secret stream at placement: Rare 65 / Legendary 35 (`SECRET.tierWeights`), never Common,
  never cracked (no lock).
- **Floor data:** the crack's pieces (kind `crackedWall`, one per cell) then the chest (kind `chest`) are appended
  after every other piece; `EndlessFloorLayout.secret` / `EndlessFloorWorld.secret` (`FloorSecret`: room, crack cells,
  facing, chamber rectangle, chest cell / facing / tier, the piece slots, the carved `dungeon`). The carved grid: the
  chamber floor FLOOR, its ring WALL, the crack cells FLOOR (blocked by their pieces while intact). `roomId` is shared
  (the chamber is in no room: -1, like a corridor), so no score record, no full-clear effect, no room spawns.
  `bfs` / `maxBfs` / stats keep describing the uncarved grid (documented on `FloorSecret.dungeon`).
- **Inert while hidden:** a crack piece takes no damage from anything (`inertPiece`): every bullet, slams, blasts,
  Demolition and Siege shocks, and sword swings (the finisher opens it instead, below). A bullet that reaches it stops, as on a wall.
  Every contact that does not open it is a **knock** (unhashed feed, no state change).
- **Openers (SRD2 / SRD3):** the crack opens the tick
  1. a player's sword finisher, the combo's third hit, reaches one of its pieces (`meleeHitBreakables`' arc test with
     the sword's `finisher` flag, its damage ignored; credited to the swinger). Swings 1 and 2 knock. Never the guard's
     erase arc, a Riposte counter-wave or any build effect;
  2. a Wrecker owner's roll step touches one of its pieces (`rollSmashBreakables`' test; credited to the roller);
  3. a heavy arrow is stopped by one of its pieces, or a Siege Bolt slams its pin into one (credited to the archer);
  4. a Charger's charge tick reaches one (the `slamBreakables` radius from the step's midpoint; credited to nobody:
     the opener is the nearest living player at that tick, for the toast only).
  Opening breaks **every** piece of the crack that tick (`brokenTick` = tick, out of `slotByCell`, `intact` down), does
  not count as broken breakables (no breakable points, loot, Wrecker smash proc or Goldling release), and pays
  `ScoreSource.SECRET` once (`SECRET_POINTS` 600 x the kills' floor scale, combo-neutral; SRD7).
- **The chest** opens on reach (`reachTiles` as the vault's), for every living present player, with the vault's
  grants for its tier: no combo, no lock, no allowance. Its points are the treasure points of its tier, into SECRET.
- **State** `state.secrets` (only with the flag): per floor the plan's slots and tier, `status` HIDDEN / OPEN / TAKEN,
  `openTick`, `openedBy`, `openHow` (FINISHER / ROLL / HEAVY / CHARGER), the chest's grants; run counters `found`,
  `taken`, `byHow[4]`; its own rng word `seedToState(seed) ^ 0x4b565352` ("KVSR") for the relic and boost draws only. Hashed as
  the `secrets` group appended LAST. No absolute timers, so a frozen draft needs no hold.

## Design

1. **Dungeon** `shared/dungeon/secrets.ts` + `secretsData.ts` (a leaf): `SECRET` (salt, fromFloor, chancePercent,
   roomTypes, crackCells, frontDepth, chambers, tierWeights, clearances), `secretCandidates(input, parts)` (pure,
   listed in a fixed order), `placeSecret(input, floor, parts)` (0 / 1 / 3 draws: chance, pick, tier), `carveSecret(d,
   plan)` (a shallow `Dungeon` copy with a new `grid`). Opt-in `EndlessFloorOptions.secrets` (true from
   `endlessRunFloor`); off or no secret: every output exactly as before (`roomPool.lock.spec` digests, the vault /
   Goldling / modifier specs). `BREAKABLE_PIECE_KINDS` gains `crackedWall` (append only; `BREAKABLE_KINDS` and its theme
   mirror stay the clutter two). Dev: `SecretOverride` (`every`, tier) like `VaultOverride`.
2. **Sim, inert kind** (`sim/breakables`): `BreakableKind.CRACKED_WALL` 3; `inertPiece(kind)` (chest or cracked wall)
   replaces every chest test in breakables.ts, siege.ts, smash.ts and treasure.ts; knocks pushed to
   `SecretEvents.knocks` (x, z, player, source) from `damageBreakable`'s early return for a crack, so every damage path
   reports them without a new call site.
3. **Sim, openers** (`sim/secrets/open.ts`, leaf hooks bound like `bindRollSmash`): `secretsOpenPiece(state, slot,
   how, player)`; called from `meleeHitBreakables` (a crack in a finisher's arc: the sword's new trailing `finisher`
   flag, set only on its finisher call, SR0), `rollSmashBreakables` (a crack in reach), `playerBulletHit`'s piece branch (crack +
   `isHeavyArrow`), siege.ts's slam (the slam point's cell or its 4-neighbours), and the Charger's charge tick
   (`secretsChargeAt(state, x, z, r)` right after `slamBreakables`). Ballista still bursts back from the opened crack
   as from a wall.
4. **Sim, state and chest** (`sim/secrets/`): `SecretsConfig` / `SECRETS_CONFIG`, `createSecretsState`,
   `secretsOnFloor` (createSimState, nextFloor), `stepSecrets` (after stepGolden: the chest's reach and open),
   `writeSecretsHash` / names, `secretsRunSummary`. The treasure grant core moves to `sim/treasure/grants.ts`
   (`grantShares(state, rng, origin, facing, tier, config)`), used by `openChest` and `stepSecrets`; the vault's draw
   order is unchanged (its open / stepTreasure specs and the vault pins pass untouched). `ScoreSource.SECRET` 16 and
   `addSecretScoreSources`. SimConfig doc and `step()`'s tick-order comment updated (step 9b).
5. **Run configs** (`shared/run`): `ENDLESS_SECRETS_CONFIG` on endless solo / co-op, the Daily, dev, the server's
   registry and validator (they share `endlessRunFloor` / `buildEndlessRunConfig`); `endlessFloorWorld` builds its five
   movers / blockers from `layout.secret?.dungeon ?? layout.dungeon`. `DAILY.ruleset` 18 -> 19. Dev `KV_SecretDebug`
   (`every`, a tier), dev world only, never submitted.
6. **View core** `shared/view/secrets/`: `SECRET_VIEW` (dust cadence, knock throttle 0.25 s, burst 0.35 s, sink 0.5 s,
   jingle at 0.4 s, shout), `secretLook(state, plan)` (HIDDEN / OPENING t / OPEN / TAKEN), `KnockThrottle`, the first
   knock latch (sighting id `secret.crack`), `SecretFrameEvents` (opened / knocked / taken per tick, for the cue
   mapper, the shout and the recap tally).
7. **World** (client): WorldController leaves the crack cells out of the wall merge; `SecretRenderController` draws the
   crack Part (wall material, the biome's world-anchored wall texture, the crack overlay on its front and top faces), the
   dust, the knock puffs, the burst and rubble, the chamber (floor, ring walls, two torches, built hidden at floor load
   and shown at the open) and the chest through `treasureBody` (shared with TreasureRenderController and
   RunMarkerController); BreakableRenderController skips `crackedWall`. `planVoid(..., holdOut)` keeps the chamber and
   ring as their own columns (absent: byte-identical); VoidController sinks them at the open. `planDecor(..., keepOut)`:
   no void piece, wall-top piece or banner on the chamber, its ring or the crack (absent: byte-identical).
8. **Minimap:** tiles stay the Forge grid's until the open; then the crack and chamber cells take their carved values,
   the whole chamber is revealed on the shared party map, and a chest mark like the vault's (hollow once taken).
9. **HUD:** the SECRET! floor shout (`FLOOR_SHOUT_PRIORITY.secret` between goldenAppear 4 and newBest 3), a toast
   `Secret found by {name}` in co-op, the chest's reward cards (treasure's, titled `Secret cache`), recap highlight
   `secrets` (`RECAP_HIGHLIGHTS`, min 1, coop team) from `RecapTally`, the first-time card. Codex (SRD12):
   `CODEX_CATALOG` gains `secret:room` in a new category `secrets` (appended last; `catalog.spec`'s order lock updated),
   read by `CodexTracker` / `readCodexFrame` from the secret frame events: seen at the first knock, found at an open the
   player is present for; the Codex screen's new section, the NEW dot and the run-over row as for every entry.
   *Catalogue shape (Track T, SR10):* the group `secrets` is the **Bestiary tab's last section** (sub-header
   `codex.group.secrets`, after the bosses), not a seventh tab: a seventh tab broke the desktop tab row's fit
   (view/codex screen.spec: 988 > 868 px). The entry is still last in the catalogue. Its art ref is `{ kind: "secret" }`,
   which `codexTileArt` does not handle yet (the unknown glyph): the view track picks its tile art (the crack, or the
   chest) and its toast route (`codexToastRoute` / `codexSummaryRank` fall to their defaults for `secrets`). The seen
   claim needs no new mapping: `CODEX_SIGHTING_ENTRIES` (shared/codex) maps the sighting `secret.crack` to
   `secret:room`, so `seedFromSightings` and the tracker's `codexSightingId` already give it.
10. **Theme:** strings `fx.secret.text` (SECRET!), `hud.toast.secret`, `treasure.secret.title`, `bestiary.secret.crack`,
    `run.recap.hl.secrets`, `score.source.secret`, the Codex entry's name / description and the category label in
    docs/CODEX.md's key scheme (l10n context entries); port audio IDs `sfx.secret.knock` /
    `sfx.secret.open` / `sfx.jingle.secret` (SILENT in the placeholder; fallbacks `sfx.breakable.hit` /
    `sfx.breakable.break` / `sfx.jingle.treasure`), appended after `sfx.codex.new` with codex.spec's tail updated;
    optional world art `secret.crack` (a one-facing greyscale overlay tinted by the biome's wall colour, darkened) and
    `secret.rubble`; optional fx `fx.secret.dust`. The dust tint role `secret.dust` (>= 40 CIE76 from the enemy-bullet
    roles and `telegraph`, like `decor.fx.*`). Keep `contract.luau` / `validate.luau` under 200 top-level locals
    (187 / 197 today, counted on out/).
11. **Art:** original pixel art by `scripts/art/gen-secret-art.js` (run by `art:build` / `art:lock`) into
    `art/vendor/kaleb-vale/secret/`, its own sheet `secret.png` (`--only secret`): the crack overlay (2 cells wide,
    3 variants), rubble (2 x 1, flat), a 6-frame dust trickle. No third-party art, no Credits entry.
12. **Debug:** `KV_SecretDebug` (dev), `KV_SecretLabel` (outline every crack, chamber and front box; the chest's tier),
    `[Secret] floor 6: room 4 crack (31,12)+x opened by heavy (player 1)` under KV_Debug.

## As built (Track T: theme, art, Codex entry; SR10, SR11, SRD12)

For the view track. Presentation data only (no sim, dungeon, hash or replay change).

- **Strings** (`shared/theme/secrets.ts`): `SECRET_STRING_KEYS`, written out last in `REQUIRED_STRING_KEYS`:
  `fx.secret.text` "SECRET!", `hud.toast.secret` "Secret found by {name}" (`{name}` the opener's display name, like
  `lobby.notice.followed`), `treasure.secret.title` "Secret cache", `run.recap.hl.secrets` "Secrets found" (a label like
  every `run.recap.hl.*`: the count is drawn beside it), `secret.room.name` "Secret rooms" (the Codex entry's name).
  The first-knock card `bestiary.secret.crack` (Knight / default: "A hollow wall. A finishing blow, a Charger's charge or
  a Wrecker roll could break through.") is `BESTIARY_STRING_KEYS`' last, and its sighting id `secret.crack` is
  shared/onboarding `SIGHTING_IDS`' last (the two lists are kept equal by a spec; nothing raises the sighting yet: SR9);
  the Archer's override `bestiary.secret.crack.archer` ("A charged arrow" instead of "A finishing blow") is
  `CHARACTER_OVERRIDE_KEYS`' last (read through shared/view/hud `characterStringKey`, the SightingCard must pass the
  local character). `score.source.secret` "Secrets" is not required (like `score.source.treasure`): add it to
  shared/view/hud `SCORE_SOURCE_KEYS` once the sim has `ScoreSource.SECRET`. Constants: `SECRET_SHOUT_KEY`,
  `SECRET_TOAST_KEY`, `SECRET_CACHE_TITLE_KEY`, `SECRET_RECAP_KEY`, `SECRET_CODEX_NAME_KEY`, `SECRET_BESTIARY_KEY`,
  `SECRET_BESTIARY_ARCHER_KEY`, `SECRET_SCORE_SOURCE_KEY`. Every key has an `l10n/context.json` entry.
- **Sounds:** `sfx.secret.knock`, `sfx.secret.open`, `sfx.jingle.secret` (`SECRET_AUDIO_IDS`), `PORT_AUDIO_EVENTS`' last
  three (after `sfx.codex.new`), SILENT in both packs; shared/view/audio `SFX.secretKnock` / `.secretOpen` /
  `.jingleSecret` in `ALL_SFX` / `PORT_SFX`, `SFX_FALLBACK` one step to `sfx.breakable.hit` / `sfx.breakable.break` /
  `sfx.jingle.treasure`, `SFX_PRIORITY` 31 / 48 / 72 (knock just over the breakable hit; crumble over the breakable
  break and the enemy sounds, under the player's own; jingle one under a Legendary chest's, with the room clear's), the
  jingle in `JINGLE_SFX` and `DUCKING_SFX`. No cue mapping yet (SR6 / SR9). Silent entries with audition candidates in
  art/audio.json (SR14).
- **Colour role** `secret.dust` `#c8bfae` (pale dusty stone; `COLOR_ROLES`' last), held by secretColors.ts
  `secretReport` (folded into `variantColorProblems`): 82.1 CIE76 from `enemyBullet`, 75.5 from `enemyBulletOutline`,
  63.0 from `telegraph` (bar 40).
- **Optional art ids:** world art slot `secret` (inline in `SLOTS`, in `WORLD_ART_SLOTS`; `image` or a one-facing
  `sprites` set with `idle`, no placeholder kind; any other `secret.` id is refused; secretArt.ts holds one facing):
  `secret.crack` (`SECRET_CRACK_ID`; a sprites set's `idle` frames are its variants: pick one per crack, never play it)
  and `secret.rubble` (`SECRET_RUBBLE_ID`); fx `fx.secret.dust` (`SECRET_DUST_FX_ID`, `FX_IDS`' last, tinted
  `secret.dust`). Read them with `pack.sprites(id)` / `pack.fx(id)`; absent = the fallback (the placeholder pack, and
  vale until upload).
- **Art (SR11):** original greyscale pixel art by `scripts/art/gen-secret-art.js` (art:build / art:lock) into
  `art/vendor/kaleb-vale/secret/`, 32 px a tile: the crack overlay 64 x 32 (2 x 1 tiles, a wall face or its top; three
  variants split / impact / mortar, pivot the centre; it only darkens: tint it with the biome's wall colour, darkened),
  the rubble 64 x 32 seen from above (lay it flat on the two opened cells; tint with the wall colour), the dust 12 x 32,
  6 frames at 10 fps, one-shot, pivot (6, 1) on the joint at the top (`fx.secret.dust` look: sizeTiles 1, not
  additive). Its own sheet **`secret.png`** (72 x 160, atlas group `secret`, `--only secret`), layout
  `packs/vale/secretLayout.ts` (`VALE_SECRET_SHEET`, `VALE_SECRET_ART_LAYOUTS`, `VALE_SECRET_FX_LAYOUTS`). Vale switches
  all three on once `secret.png` has an ID in `assetIds.ts` (not uploaded: the owner's step); when it does, the stage
  manifest (shared/view `STAGE_ASSETS`) must list `secret.` or `stageAssets.coverage.spec` fails.
- **Codex (SRD12):** entry `secret:room` (`CODEX_SECRET_ID`, `codexSecretId()`), group `secrets` (the Bestiary's last
  section, see Design 9), name `secret.room.name`, description `codex.desc.secret.room` ("Secret rooms: a cracked wall
  that knocks hollow hides a chamber and its chest"), kind line `codex.kind.secret` "Secret", sub-header
  `codex.group.secrets` "Secrets", art ref `{ kind: "secret" }`, no hint; catalogue 86 -> 87 (order lock updated);
  `CODEX_SIGHTING_ENTRIES` maps the sighting `secret.crack` to it (seed and tracker).
- `contract.luau` / `validate.luau` top-level locals unchanged at 187 / 197 (counted on out/).

## As built (Track V1: the pure view layer; SR6, SR7-SR9's pure parts)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change), all of it pure and headless in
`shared/view/secrets` (its own barrel, like `shared/view/treasure`: import `"shared/view/secrets"`) plus small hooks in
the existing view modules. Every time is sim seconds on the views' clock (`(tick + alpha) / SIM_HZ`).

### What each client controller calls (Track V2)

| Controller | Per floor / run | Per frame |
|---|---|---|
| **SimController / RunView** | nothing new | `run.secrets` (SecretFrameSource: `knocks`, `opened`, `taken`) is filled by LiveRun and LockstepClient like `run.treasure`; read it after the frame's ticks |
| **WorldController** | `secretWallMergeGrid(grid, d.W, layout.secret)` on its merge copy (after solid decor -> FLOOR): the crack cells become `SECRET_CRACK_CELL`, so no floor / wall rect spans them | nothing |
| **SecretRenderController** (new) | `secretChamberBuild(plan, layout.dungeon, plan.dungeon)`: build hidden the chamber floor rect, its own wall rects (never the parent's wall line), two torches (back wall, facing in), the chest (through `treasureBody`) and the crack Part (`build.crack`: wall material, world-anchored wall texture, `secret.crack` overlay) | one `SecretViewTracker.update(state, plan, run.secrets, simSec, { reducedMotion })`: `look.crackShown` / `chamberShown` / `torchesLit` / `chestOpen` / `dust` (`fx.secret.dust`, frame and cell) / `burstU` / `bursting`; edges `openEdge` (burst, rubble, `stamp` nudge, solo `SECRET_VIEW.burst.freezeMs` freeze for an open by the view player, `secretShout(o, state, viewIndex)` -> ComboController.requestShout), `revealEdge` (torches; the jingle is the audio's), `takenEdge` (the vault's open with `secretRewardTexts(s, t, viewIndex)`: `title` Secret cache where the vault's line goes, `cards`; draw the chest's opening with a shared/view/treasure `PedestalChestTracker`: `reset([taken ? 1 : 0])` per floor, `update(0, look.chestOpen, true, simSec, reduced, particles, out)`: jolt, pop, column), `puffs` (one dust puff each, already throttled); `secretOpenLogLine(floor, plan, o)` under KV_Debug; `secretDebugLabel(plan, status)` for KV_SecretLabel |
| **VoidController** | nothing new: `voidRunInput` -> `voidInputOfLayout` now carries `holdOut` (the ring) on a secret floor; `plan.held` lists the rect indices to sink | lower the held columns by `secretSinkTiles(look)` tiles (0 hidden, the whole `SECRET_VIEW.sink.depthTiles` once sunk; at once under reduced motion) |
| **DecorController** | nothing new: `decorInputOfLayout` carries `keepOut` (the ring) | nothing |
| **BreakableRenderController** | skip `isInertPieceKind(kind)` slots instead of `isChestPiece` (a crack must never draw as a barrel; the tracker already never lists it) | nothing |
| **CollisionDebugController** | `collisionDebugDungeon(world.dungeon, world.secret)` instead of the Forge's dungeon | as before (`solidCells(state)`) |
| **MinimapController** | tiles from the Forge grid as today | on the open (the tracker's `openEdge`, or the first frame `look.phase >= OPENING` for a late view): `const ch = secretMapChange(tiles, plan)`, repaint `applySecretMapChange(tiles, ch)`, `fog.revealCells(ch.reveal)` (once per floor); the chest mark `secretMarkStyle(state.secrets.status, plan.tier)` at the chest cell (MINIMAP_VIEW.markers.vault's look) |
| **AudioController** | `secretCues.reset()` with the vault's tracker | `secretCues.update(state, plan, run.secrets, simSec, listener)` (a `SecretCueTracker`), passed as the cue mapper's new trailing `secrets` argument: the knock, the crumble, the jingle and, on the chest lid's pop (`chestTier`, TREASURE_VIEW.open.popSec after the take), the vault's open sting by tier and a Legendary's jingle |
| **Toasts** | | for each `run.secrets.opened`: `secretToast(o, state, localIndex, nameOf)` (party runs, everyone but the finder) |
| **SightingController** | `FirstKnockLatch.reset()` on run exit | `latch.observe(run.secrets, localIndex)`; `withSecretSighting(withRumourSighting(found, ...), latch.knocked())`; the card's key `sightingCardKey(id, character, has)` (the local run character: the Archer reads `bestiary.secret.crack.archer`) |
| **CodexController** | | after `readCodexFrame`: `readCodexSecrets(frame, run.secrets, localIndex)` (cleared by `clearCodexFrameEvents`) |
| **RecapController** | `secrets: state.secrets !== undefined ? secretsRunSummary(state) : undefined` in RunRecapInput, beside `chests` | |
| **DevModeController** | read `KV_SecretDebug` (`parseSecretDebug`) into DevRunOptions.secret, like `vault` (SR5's pending wiring) | |

### Modules

- `config.ts` `SECRET_VIEW`: dust (every 4 s, 6 frames at 10 fps, cell by cell), knock (throttle **0.2 s**, puff 0.3 s),
  burst (0.35 s, 12 shards, the vault's 40 ms freeze), sink (0.5 s, 3 tiles), reveal (jingle at 0.4 s), `openingSec`
  (0.5 s), shout (1.4 s, near 9 tiles), toast (3 s), audio near (9 tiles).
- `events.ts` `SecretFrameEvents` / `SecretFrameSource` / `NO_SECRET_EVENTS`: `knocks` (tick, slot, the cell's world
  centre, BreakableSource, player or -1), `opened` (the sim's SecretOpened plus facing, room, tier, chest centre),
  `taken` (opener, tier, points, the vault's TreasureGrantView per share, chest centre and facing). Collected after
  every tick in `LiveRun.observeTick` and `LockstepClient`'s step loop, reset every frame.
- `look.ts` `secretLook(state, plan, simSec, settings)` (`SecretPhase` NONE / HIDDEN / OPENING / OPEN / TAKEN; a plan
  that is not the state's secret is NONE), `secretMatchesPlan`, `secretOpenSec(openTick)` (= the open event's
  `tick / SIM_HZ`), `secretDustAt`, `secretSinkTiles`, `SecretViewTracker` (edges only from the frame's own events: an
  open met mid-way is silent, its look still right).
- `knock.ts` `KnockThrottle` (per crack; a clock going back resets it), `FirstKnockLatch`, `localKnocked`.
- `cues.ts` `SecretCueTracker` / `SecretCueSource` (knock / open / jingle with their `*Near`, `chestTier`) /
  `NO_SECRET_CUES`, `secretCrackCentre`, `playerNear`; the mapper's `chestOpenCues(tier)` is shared with the vault's
  `treasureCues` (byte-identical for the vault).
- `geometry.ts` (a leaf: voidDecor and decor import it by file) `CellRect`, `inCellRect`, `secretRingRect`,
  `secretCrackList` / `secretCrackIndices`, `SECRET_CRACK_CELL`, `secretWallMergeGrid`, `secretChamberBuild`.
- `minimap.ts` `mapTileOf`, `secretMapChange` (after it the tiles equal `minimapTiles(plan.dungeon)` everywhere),
  `applySecretMapChange`, `secretMarkStyle`; `minimap/fog.ts` `FogOfWar.revealCells(cells)`.
- `news.ts` `SECRET_TEXT_KEYS`, `secretShout` (FloorShoutRequest in the chest tier's floor role), `secretToast`,
  `secretRewardTexts`, `secretOpenLogLine`, `secretDebugLabel`.
- Elsewhere: `FLOOR_SHOUT_PRIORITY.secret` 3.5 (hud dailyRankConfig.ts); `RECAP_HIGHLIGHTS` `secrets` (priority 9,
  min 1, coop team, label `SECRET_RECAP_KEY`; Chests and the later rows renumbered 10-15) with `RunRecapInput.secrets`;
  `SCORE_SOURCE_KEYS` + `score.source.secret`; Codex `CodexFrame.secretKnocked` / `secretOpened`, `readCodexSecrets`,
  the tracker's `secret:room` observations (events: the run's last frame counts them), route `card` (seen) / `codex`
  always (found), summary rank with the bosses, tile art a `label` (the entry's name in `secret.dust`); sighting
  `SECRET_CRACK_SIGHTING`, `withSecretSighting`, `sightingCardKey`; `rewardCardTexts` / `grantOf` typed on
  `grants` / `points` only (any open with grants reads there); `planVoid` hold-out (`VoidPlanInput.holdOut`,
  `VoidPlan.held`, planVoidCached keys on it); `planDecor` keep-out (`DecorPlanInput.keepOut`, drop reason
  `secret`); `isInertPieceKind`; `collisionDebugDungeon`; stage feature `secret` (`secret.`, `fx.secret.dust`, the
  chest's art), set by `stageInputOfLayout` only on a floor with a secret.

### Corrections to the plan (Track V1)

- **Knock throttle 0.2 s, not 0.25 s:** the sword's swings 1 and 2 land 14 ticks (0.233 s) apart (the port's tempo),
  so 0.25 s swallowed the second swing's puff and knock. One swing's pass over both cells is still one knock.
- **decorPlan l. 1080's `p.kind === "chest"`** reads the Forge's props (the treasure room's chest prop), never the
  breakables: no change. The crack and secret chest reach planDecor only through `breakables` (kept out as before);
  the keep-out covers the ring itself.
- **The Codex seen claim needed its own observation:** `CODEX_SIGHTING_ENTRIES` only serves the seed and the card's
  chip (`codexSightingId`); the tracker rises only from frame fields, so the knock is `CodexFrame.secretKnocked`.
  Knocks and the open count as events (the last frame still counts an open); "present" = in the run (the tracker
  stops at `left`), dead spectators included.
- **Whose knock:** the first-time card and the Codex seen are the LOCAL player's knock only (not a teammate's, an enemy
  bullet's or a Charger's), so the card's text (the local character's) names what that player can do.
- **The co-op toast** shows to every member but the finder (who has the shout); the shout shows to the view player
  when they opened it or stand within 9 tiles of the crack.
- **The keep-out leaves torches:** Forge torches keep their cells (SR1 keeps them off and away from the crack); a tall
  piece pushed off the keep-out may take another far-wall spot (and drop or free a torch under it, as on any floor).
- **Tile art** is the entry's name (a `label`), not the crack or the chest: the crack overlay is darkening on a
  transparent ground and the chest is the vault's, neither reads as the feature on a dark tile.

## Tasks

- [x] **SR0. Confirm the code assumptions.** Each table row read or corrected here; in particular: the roll smash
  reaching a crack head-on and at 45 degrees; the Charger's reach at the box edge (rect and ellipse rooms); every place
  that tests `kind === CHEST` or the `"chest"` name (sim, view, bots, golden flee field / mask, pact altars, stage
  manifest); what besides `endlessFloorWorld` builds movers from `layout.dungeon` (BulletAhead, local prediction,
  collision debug, the bots' `pathField`); that no consumer of the sim world reads `bfs` from the carved copy.
  → Verify: every row marked.
- [x] **SR1. Placement and census** (`dungeon/secrets*.ts`, no sim). → Verify (spec): no secret on floor 1 or in a
  boss / entrance / shrine / treasure room; every chamber inside the grid, its ring touching no other floor, one way in;
  the front box clear; the salt unique; option off byte-identical (`roomPool.lock.spec` digests, vault / Goldling /
  modifier specs). Census (`secrets.census.spec.ts`, `--census`, runs 1-60 x floors 2-30, solo and party 3, sharded if
  over a minute): secret floors against SRD1's 25 %, chance hits with no candidate (by depth: do deep floors fit as
  well as shallow ones?), candidates per floor, chamber sizes, the share of crack rooms with a planned Charger (the
  Archer's third key).
- [x] **SR2. Inert kind and knocks.** → Verify: kinds 0-2 byte-identical (every breakables, siege, smash, treasure
  spec; the determinism pins); a crack takes no damage from every bullet kind, slams, a Bomber blast, Demolition, a
  Siege shock; each such contact is one knock; a bullet stops on it; bodies and the Charger's plain move stop
  on it.
- [x] **SR3. Openers.** → Verify (specs on a built secret floor): a finisher opens it (from the front box and at its
  full reach, with and without the lunge closing in), swings 1 and 2 knock, the guard does nothing, a Riposte counter-wave and Thunder Guard sparks do not; a
  Wrecker roll opens it, a roll without Wrecker does
  not; a heavy arrow opens it (stream arrows, Volatile bolts and Ballista bursts do not), a Siege slam into it opens
  it; a Charger lured into it opens it, a Charger charging past it does not; one opening breaks both pieces the same
  tick; no breakable points, loot, smash proc or Goldling release.
- [x] **SR4. State, chest, score, hash.** The grant core moved, `stepSecrets`, SECRET score source, the `secrets`
  group. → Verify: the vault's specs and pins pass unchanged; a chest open grants each living present player their
  share; Legendary's bonus deal is taken by the next draft; points into SECRET only with the flag; a scored run
  without it keeps its sources and hash.
- [x] **SR5. Run configs and replays.** → Verify: endless / daily / dev on, M1 / tutorial off; M1, every golden fixture
  and the tutorial bit for bit; the server validator replays a run that opened a secret; the charger / stormcaller /
  vault pins re-recorded only where a secret now stands; `DAILY.ruleset` 19; `KV_SecretDebug` dev only.
- [x] **SR6. View core** (`shared/view/secrets`). → Verify (spec): looks per status, the throttle, the first-knock
  latch, frame events from replayed states. (Track V1: secrets.spec, play/secretsView.spec.)
- [ ] **SR7. World render.** Crack Part, overlay, dust, knocks, burst, chamber reveal, void hold-out, decor keep-out.
  → Verify: `planVoid` / `planDecor` byte-identical without a secret (their specs); with one, no column merges across
  the hold-out and no piece stands in the keep-out. Studio part in SR15. (Pure parts done, Track V1: holdOut.spec,
  decorPlan.secret.spec, secrets/world.spec; the controllers are Track V2's.)
- [ ] **SR8. Minimap.** → Verify (spec): the chamber unknown before the open, revealed whole at it, the chest mark.
  (Pure parts done, Track V1: secrets/world.spec; MinimapController is Track V2's.)
- [ ] **SR9. HUD, toasts, recap, first-time card, Codex.** → Verify: shout priority, co-op toast, the highlight in the
  recap specs, the card once per player; the Codex entry seen at the first knock and found at an open (claims only from
  endless / the Daily, never dev or a debug run), the catalogue order lock at 87, the Codex screen's section on the
  smallest phone. (Pure parts done, Track V1: recap.spec, codex/secrets.spec, sighting.spec, secrets.spec; the
  controllers and the screen check are Track V2's.)
- [ ] **SR10. Theme.** → Verify: contract / validator specs, the role report, l10n check, codex.spec's tail and the
  listed specs' skips, Luau locals counted.
- [ ] **SR11. Art.** → Verify: the sheet's lock; with and without the art (no art: the wall's own look with a darker
  band and the dust, still readable).
- [ ] **SR12. Docs.** This doc's as-built; CLAUDE.md docs row and decision log; cross references in TREASURE.md,
  BUILDS_V2.md, ARCHER.md, NEW_ENEMIES.md, DECOR.md, VOID_DECOR.md, MINIMAP.md, DAILY.md, DEV_MODE.md, RUN_RECAP.md,
  CODEX.md (the new category and entry), FLOOR_MODIFIERS.md (no secret modifier, SRD14).
- [ ] **SR13. Bot census of discovery** (opt-in): the endless bot with an "investigate" option (walk the front box of
  every crack it can see and try its weapon on it) per character and with / without Wrecker: share of secrets opened,
  time spent, for the Archer how often she needed a charged shot vs a Charger. → Verify: numbers recorded; SRD1 / SRD4 /
  SRD6 revisited with the owner.
- [ ] **SR14. [owner] Audio:** pick the knock, the crumble and the discovery jingle (`art/audio-audition.html`). The
  jingle carries the feature: short, bright, unmistakable, original.
- [ ] **SR15. [owner] Studio check and playtest** (below). The question: does a new player notice the crack, try
  something on it, and tell someone about the room behind it?
- [ ] **SR16. Telemetry (optional).** Per secret floor: found or not, opener, seconds from floor start, character,
  chest taken.

## Decisions (all answered by the owner, 2026-11-13)

- **SRD1. How often? -> 25 %** (owner; first given as "srd2 25%", confirmed): at most one per floor, a flat 25 % of
  floors from floor 2 (no depth bands), boss floors allowed (never the boss room). SR1's census reports the real rate
  after "no candidate" misses.
- **SRD2. Which openers? -> four**, following SRD3: the sword finisher (Knight), the heavy arrow with Siege Bolt's slam
  (Archer), the Wrecker roll (anyone with the boon), the Charger. Not the Bomber's blast, the boss slam, Demolition's
  chain, Ballista's bolts, stream arrows, the sword's first two swings or its guard: they knock.
- **SRD3. The Knight's key -> his sword, on the third hit of the combo** (owner): the finisher that reaches the crack
  opens it; swings 1 and 2 knock. So every crack is open to both characters and no room is weighted toward Chargers
  (the planned x4 weight is gone), and each character has the same puzzle: the ordinary hit knocks, the heavy one
  (finisher / charged arrow) opens.
- **SRD4. How visible? -> crack + dust** (owner): the crack art on the face and top and a sparse dust trickle, readable
  once you look; no chip, card, sound or map mark before it opens. Noticing it is most of the difficulty, so SR15 tunes
  the dust cadence and the overlay's contrast.
- **SRD5. Teach the openers? -> yes** (owner): one first-time card after a player's first knock, naming the openers
  (*how*, never *where*); the Knight's text names the finishing blow, the Archer's the charged arrow.
- **SRD6. The reward -> the chest, Rare 65 / Legendary 35** (owner): opens on reach, no lock, a share for every living
  present player; Rare a relic each, Legendary a bonus deal + a boost each, never Common.
- **SRD7. Points -> on the open and from the chest** (owner): `ScoreSource.SECRET` 600 x the kills' floor scale when
  the wall opens, plus the chest's treasure points for its tier, combo-neutral, shown as `Secrets` in the breakdown.
- **SRD8. A Charger that opens it by accident -> it opens** (owner): the wall bursts mid-fight; still your discovery.
- **SRD9. Co-op -> one opens, all share** (owner): one opener for the party, a chest share for every living present
  player (the vault's rule).
- **SRD10. Size and shape -> a small chamber** (owner): one entrance, 3 x 3 to 5 x 4 tiles straight behind the wall. A
  passage to a farther room is a later wave.
- **SRD11. Enemies inside -> none** (owner) in wave 1. An "ambush" secret is a candidate for wave 2.
- **SRD12. Tracking -> the recap highlight and one Codex entry** (owner): the run-over `Secrets found` highlight, and
  ONE new Codex entry `secret:room` ("Secret rooms") in a new category `secrets` appended after every existing one
  (docs/CODEX.md: append-only order lock, 86 -> 87 entries): **seen** at a player's first knock (the first-time card's
  moment; the card's sighting id `secret.crack` claims it instead of being pinned as no entry), **found** at the first
  secret they open or whose opening they are present for. No lifetime count in `KV_Records_v1`.
- **SRD13. Daily -> on** (owner): the day's seed places the secrets, the same for everyone.
- **SRD14. Floor modifier -> none** (owner): announcing a secret would undo the feature.

## Risks

- **Free void.** Rooms are doubled on endless floors and packed with corridors between them; far walls with 4+ void
  cells behind may be rarer than hoped, especially away from the grid's edge. SR1's census decides whether SRD1's
  rates hold or the chamber sizes shrink.
- **Visibility.** A crack too subtle is never found; too loud and it is a signpost. The dust cadence and the overlay's
  contrast are the knobs (SR15).
- **Accidental Knight opens.** The finisher is a 180 degree, 2.53-tile arc with a lunge, so a combo aimed at an enemy
  standing near the crack can open it by accident. Fine for a hook (still a "wait, what?"); SR13 compares the two
  characters' find rates.
- **Finishing on a wall.** A combo with nothing to hit still runs through to the finisher while FIRE is held, but the
  combo resets if FIRE is let go for `comboWindowTicks` after a swing: SR15 checks that holding FIRE at a wall reads
  naturally and that the lunge does not carry the Knight off the front box.
- **The inert-kind refactor.** Every chest test becomes `inertPiece`; a missed one would let the crack be broken by
  the wrong source (a bullet, a slam). SR0 lists them, SR2 tests each damage path.
- **Two grids.** The sim walks the carved grid, the view draws the Forge's until the open. Anything in the view that
  answers "is this cell walkable?" for the local player (collision debug, local prediction's mirror, BulletAhead) must
  read the sim's movers, not `layout.dungeon` (SR0 lists them).
- **Hiding in the chamber.** One entrance, two cells wide: enemies follow and bullets fly in, so it is no safe room;
  watch it in SR15 anyway.
- **Composition.** A Hoard / Gilded / Plunder floor with a secret is fine (independent rolls, the secret runs last); a
  chest in a vault room's wall reads like a second vault (the reward cards' `Secret cache` title separates them).

## Studio check

Dev panel (**F2**), `KV_SecretDebug` = `every` (optionally `every legendary`), `KV_SecretLabel` on, start floor 3,
the Knight, then the Knight with Wrecker forced from the dev panel's boons, then the Archer:

- The labelled crack on a far wall: the overlay on the face and top, the dust every few seconds, no seam with the wall
  texture beside it; behind it, the same void rock as any other wall.
- Knight: swings 1 and 2 give the dust puff and the hollow knock, no damage, and the first-time card once (naming the
  finishing blow); holding FIRE through to the finisher opens it; on the next floor a finisher from full reach; the
  guard against it does nothing.
- Archer: stream arrows knock the same way; her card names the charged arrow.
- Roll into it with Wrecker: the burst, the rock sinking, the chamber with two torches and the chest; SECRET! on the
  floor; the jingle; `[Secret] ... opened by roll`. The minimap shows the chamber and the chest mark.
- Archer: a full charge at the crack opens it; with Ballista the burst flies back into the room.
- A room with a Charger (dev start floor 10, the full roster; `KV_SecretLabel` shows which crack rooms plan one):
  stand in front of the crack, roll aside as it charges: the wall opens, the Charger is stunned.
- Walk to the chest: the vault's open with `Secret cache`, a relic (Rare) or a bonus deal + boost (Legendary).
- Co-op: one opens, every client bursts the same tick; every member gets a share; the recap's `Secrets found`.
- Codex: after the first knock the `Secret rooms` entry is seen (NEW dot), after the first open found; the run-over row
  lists it.
- Without the override, endless seeds 1-10 from floor 1: cracks on about one floor in four, none on floor 1, none in
  the boss room. Reduced motion: no dust, no sink (the chamber cuts in). Touch and portrait: the crack readable on a
  phone.
