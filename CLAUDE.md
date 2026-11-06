# Kaleb-Vale (Roblox port)

A port of the web game **Project Kaleb-Vale** (top-down bullet-hell ARPG, M1 "First fight") to Roblox.
**roblox-ts + Flamework + Reflex + React**, synced with Rojo. The plan is `PLAN.md`; work it task by task.

## The source project

`/Users/kalebmon/Documents/project-kaleb-vale` @ **`42897e2`** (Three.js / TypeScript). It is the reference:
its outputs are exported as golden JSON fixtures (`fixtures/`) and this build must match them bit for bit.

**It is READ-ONLY.** Never modify it, commit to it, or run its build. Read its code; port from it.
Record every ported module in `PROVENANCE.md` (ported module, source path, source commit).

## Documents

| File | Authority over |
|---|---|
| `PLAN.md` | Scope, decisions, task order, go/no-go gates |
| `PROVENANCE.md` | One row per ported module: source path + source commit |
| `docs/SPIKES.md` | Task 1 spikes: how to run them in Studio and the recorded results |
| `docs/ART.md` | Vertical-slice art: packs, licences, contract v2, atlas pipeline, renderer, status |
| `docs/TUTORIAL.md` | First-run tutorial ("Practice Descent"): plan, as-built notes, tasks T1-T8, owner decisions |
| `docs/TUTORIAL_ARROW.md` | Tutorial guidance arrow (floor chevron pointing along the path to the objective): plan, tasks A1-A6, decisions |
| `docs/TUTORIAL_MAP.md` | Tutorial map lesson (step `map`, 11 of 17, after combat F: open the full map; waived if ignored, marker `next`, funnel revision 2): plan, tasks TM1-TM7, decisions TMD1-TMD8 |
| `docs/TUTORIAL_FUNNEL.md` | Tutorial analytics funnel (once-per-user onboarding funnel join -> lessons -> completed, `TutorialAttempt` funnel, lesson time / hits / stuck, skip / abandon / outro / gate events, new-player runs and return): plan, tasks TF0-TF9, decisions TFD1-TFD10 |
| `docs/OUTLINE.md` | Enemy outlines: plan, as-built notes, tasks O1-O7, decisions E1-E6 |
| `docs/PLAYER_OUTLINE.md` | Player outline (rim around the watched player only, `playerOutline` role, 1 px knight sheets, Display setting): plan, as-built, tasks P1-P7, decisions |
| `docs/FX_AUDIO.md` | Sprite effects and audio (Ninja Adventure FX / Audio): slots, pipelines, cue mappers, tasks X0 / F0-F6 / A0-A5 |
| `docs/SPECTATE.md` | Co-op spectating (watch and switch between living teammates after a death): plan, tasks S0-S6, decisions |
| `docs/BOOSTS.md` | Temporary boosts dropped by killed enemies (Fury / Quickstep / Frenzy / Aegis): plan, tasks B0-B11, decisions |
| `docs/BOOST_ART.md` | Boost drop art (Lords of Pain gold coins and gemstones, tinted halo and beam, gems out of decor): plan, tasks BA0-BA7, decisions |
| `docs/BREAKABLE_DROPS.md` | Boosts from breakables (some barrels / crates hold a boost, picked per floor from the floor seed, released on any break, a soft glint on loaded pieces): plan, tasks BL0-BL9, decisions BLD1-BLD9 |
| `docs/SNIPER_ART.md` | Sniper art (`enemy.sniper` as the Lords of Pain subservient): mapping, budget, tasks SN1-SN8, decisions D1-D6 |
| `docs/BOSS_DEMONLORD.md` | Demon Lord boss variant (`boss.demonlord`, seeded pick per endless boss floor, Lords of Pain Demonlord art): plan, tasks D0-D8, decisions |
| `docs/CURSOR.md` | Gauntlet mouse cursor (Lords of Pain `cursor_gauntlet_*`, software cursor, hover / target colours): plan, tasks C0-C8, decisions D1-D5 |
| `docs/DEMON_ART.md` | Placeholder enemies as 2D Demons (bruiser = Demon Beast 3; turrets sprayer / caster = Demon Spawn 8 / 11; Lords of Pain art unchanged): plan, tasks DA0-DA15, decisions DD1-DD7 |
| `docs/BRAMBLE_ART.md` | Mother Bramble (`boss.act1`) as a 2D Demons Elite: state-to-animation mapping, size and budget, tasks BR0-BR7, decisions BD1-BD7 |
| `docs/ROOM_EDGES.md` | Room edges (dashed floor line where every corridor meets a room, tinted safe / waiting / live): plan, tasks RE1-RE8, decisions RD1-RD9 |
| `docs/VOID_DECOR.md` | Void decoration (rock shoulder along every wall and corridor, ledges, a dark biome-tinted abyss, set pieces framing rooms from behind their far walls; presentation only): census, plan, tasks VD0-VD11, decisions VDD1-VDD9 |
| `docs/HUD_LAYOUT.md` | In-run HUD footprint (corner panels, full-width band fix, info line to the pause menu, occlusion fade): plan, tasks H1-H9, decisions HD1-HD8 |
| `docs/FEEL.md` | Game feel pass (hurt flash and jolt, hit flash / hold / push, squash & stretch, roll afterimages, low-health pulse, screen shake setting): plan, tasks J1-J12, decisions JD1-JD13 |
| `docs/MINIMAP.md` | Minimap with fog of war (corner map + full-map toggle, sight + whole-room reveal, shared party map): plan, tasks M0-M12, decisions MD1-MD14 |
| `docs/PRELOAD.md` | Asset preloading (join loading screen for the core tier, background queue for bosses / later music): plan, tasks P0-P7, decisions D1-D6 |
| `docs/STAGE_LOADER.md` | Stage loader (cover while a floor generates and loads: run start, stairwell card, pre-generation during the boon draft, deferred view rebuilds): plan, tasks SL0-SL8, decisions SD1-SD6 |
| `docs/INVITES.md` | Roblox friend invites (`PromptGameInvite` + LaunchData into a lobby) and Roblox Party grouping: plan, tasks I0-I9, decisions ID1-ID7 |
| `docs/MOBILE.md` | Mobile play (two-stick touch controls with auto-target, touch HUD, touch menus / tutorial, real-device performance): plan, tasks MB0-MB16, decisions MBD1-MBD10. Step-by-step build: `docs/MOBILE_IMPL.md` (MB1-MB13) |
| `docs/ROOM_CLEAR.md` | Room clear celebration (1.5 s: 0.5x slow motion on the last kill, CLEAR / PERFECT stamp, room score tally rolling into the score panel, a corner chip for a far co-op clear, On / Off setting; presentation only): plan, tasks RC0-RC10, decisions RCD1-RCD18. Step-by-step build: `docs/ROOM_CLEAR_IMPL.md` (RC1-RC9) |
| `docs/COMBO.md` | Combo you chase (named tiers x2 Rampage / x3 Carnage / x4 Dominating / x5 Unstoppable, tier-coloured meter, kill sound climbing in pitch, tier-up sting and a floor shout that never hides bullets, a shatter on a break during a fight, a quiet lapse otherwise; presentation only): plan, tasks CB0-CB9, decisions CD1-CD16 |
| `docs/DRAFT_REVEAL.md` | Boon draft reveal (cards deal face down and flip one by one, a rare chime, a legendary beat: charge, hush, flare and halo; a pick stamp; skip by pressing; the client holds the confirm until settled; cards in the ToffeeCraft Horror UI sheet's style; presentation and client input only): plan, tasks DR0-DR9, decisions DRD1-DRD12 |
| `docs/ENEMY_VARIANTS.md` | Enemy variants (three new endless archetypes: Imp flanker, Ooze zone-denier that splits, Summoner support; elite affixes Hulking / Swift / Shielded / Vengeful; both unlock by depth): plan, tasks EV0-EV14, decisions EVD1-EVD12 |
| `docs/GRAZE_PARRY.md` | Grazes and parries (graze spark + shimmer climbing in pitch, parry sparks / ring-out / PARRY! floor flash / solo 30 ms freeze for a guard that erases bullets; one unhashed ScoreEvents feed, otherwise presentation only): plan, tasks GP0-GP10, decisions GPD1-GPD10 |
| `docs/UI_ART.md` | UI art (the dark red pixel UI sheet: 9-sliced panels / buttons, hearts, potions, pills, icons, focus brackets; menus, then the in-run HUD, then touch; presentation only): builds on the Draft reveal (`slice`, `SlicedImage`): plan, as built, tasks UA0-UA15, decisions UAD1-UAD10 |
| `docs/NEW_BEST.md` | New-best celebration (points-to-best in the score panel's label row, a fanfare + NEW BEST stamp / floor shout / edge confetti when the shown score passes your best or you reach a floor past your deepest, a record fanfare and old -> new roll at run over; server-owned personal records doc `KV_Records_v1`; no sim change): plan, as built, tasks NB0-NB11, decisions NBD1-NBD11 |
| `docs/DEV_MODE.md` | Developer mode (jump to any floor, instant R restart, god mode; local `dev` world, server-allowed players only via `DEV_MODE`): usage, access, how it works |
| `docs/BUILDS.md` | Builds (on-kill boons Chain Spark / Volatile / Soul Shards with chain reactions, boon levels with an evolution at III, duo boons, the boss double draft; gameplay, opt-in `SimConfig.builds` on endless only): plan, tasks BU0-BU14, decisions BUD1-BUD14 |
| `docs/DAILY.md` | Daily dungeon and seeded rosters (every endless seed picks its enemy kinds: swarmers + 1 on floor 1, one more every 2 floors; a `daily` world with one server-side seed per UTC day, day-scoped solo / co-op boards, percentile, friends, rank climbing, yesterday's podium): plan, tasks DS0-DS14, decisions DSD1-DSD16 |
| `docs/LOCALIZATION.md` | Language localization (the 17 languages Roblox auto-translates; player's Roblox language by default, a Language override in Options; translations from the Roblox cloud table, imported into validated generated tables; AutoLocalize off on every GUI; fonts per script; pseudo-locale `en-XA`): plan, as built, tasks L0-L15, decisions LD1-LD14 |
| `docs/PORTRAIT.md` | Portrait play (phones turn either way, `Sensor`; upright the view keeps the short side at `VIEW_TILES_HIGH` with the player lifted above the thumbs, touch controls in a bottom band, pause map on top, the draft in a column, the HUD scale capped to the width): plan, tasks PT1-PT9, decisions PD1-PD7 |
| `docs/NEW_ENEMIES.md` | New enemies (five endless room archetypes from floor 2: Bomber rusher that blows up, Charger lane charge stunned by walls, Stormcaller lightning strike rows, Warbanner aura support, Reaper bullet spiral; band 4, `BulletKind.STRIKE`, the Warbanner aura in `actorMods`; gameplay): plan, NE0 findings, tasks NE0-NE14, decisions NED1-NED14 |
| `docs/PELLETS.md` | Pellets (Pac-Man lines of small cubes laid on a fight's floor, collected while enemies live, a Sweep bonus for every one, a rare power pellet that turns every enemy bullet on the floor into points; tutorial room G with a sweep lock; gameplay): plan, as built, open owner calls, tasks PL0-PL15, decisions PD1-PD16 |
| `docs/RUN_RECAP.md` | Run-over recap and co-op moments (one honest near-miss line, up to four counting highlights, Again in one press armed at 0.6 s and a faster retry; co-op TEAM PERFECT stamp / chip / streak / pulse rings and SYNC! parries; revives reserved; presentation only): plan, tasks RR0-RR11 / CM1-CM7, decisions RRD1-RRD11 / CMD1-CMD7 |
| `docs/BOOKSHELVES.md` | Bookshelves (Dungeon Essential Kit bookcases, solid 1 x 1 cases flush in runs on rooms' far walls; a new `library` room theme plus a run in some `hall` rooms; endless layouts change): plan, tasks BK0-BK10 / RA1-RA6, decisions BKD1-BKD14; the library's reading area, a table and two chairs |
| `docs/TREASURE.md` | Treasure rooms (vaults: about one endless floor in two from floor 2 has a caged chest in a combat / elite room, seen through the doorway; clearing the room unlocks it, its lock (UNTOUCHED / SWIFT) kept or cracked one tier down; walk up to open it: a relic, boosts or a bonus draft; gameplay, opt-in `SimConfig.treasure`): plan, TR0 findings, as built TR1-TR8, tasks TR0-TR11, decisions TRD1-TRD14 |
| `docs/FORTUNE.md` | Fortune (risk shrines: two pact altars in the shrine room, Greed = a shown curse + a Legendary deal now, Horde = the next room fights a second wave for x2 score; the Goldling: a rare harmless gold enemy that flees within its room, coins per hit, a jackpot if caught within 10 s; gameplay, opt-in `SimConfig.pacts` / `SimConfig.golden` on endless only): plan, as built, open owner calls, Studio check, tasks FO0-FO13 / PS1-PS5 / GE1-GE4, decisions FD1-FD16 |
| `docs/PROJECTILE_ART.md` | Projectile art (every flying bullet drawn with the Player Bullets pack: yellow / green bolts and the Hyper flame for the player, chevron / needle / teardrop recoloured into the danger pink for enemies, optional `fx.bullet.hit`; goo / strike / ember unchanged; presentation only): plan, measured pack, mapping, tasks PA0-PA10, decisions PAD1-PAD11 |
| `docs/GOO_ART.md` | Goo art (the Ooze's goo puddles drawn with the heimlich3 Slime pack's last two frames: land then splat, recoloured into `enemyGoo`, flat on the floor sized to cover the hit; presentation only): plan, tasks GA0-GA7, decisions GAD1-GAD5 |

Decision log (deviations from `PLAN.md`):
- **Art (docs/ART.md).** The theme contract gained a `"sprites"` kind (large pre-rendered cells, 1/4/8/16 screen-space
  facings, several atlases per set, `pixelsPerTile`) next to the web build's 16 px `spritesheet`; tile images may repeat
  (`tilesPerImage`) and ui images carry a `pivot`. The default pack is `vale` (`shared/config/theme.ts`), which equals
  `placeholder` until ids are pasted into `packs/vale/assetIds.ts`. Raw art packs live in gitignored `art/vendor/`
  (licences forbid redistribution); `npm run art:build` makes the atlases.
- The HUD uses **Reflex** (`@rbxts/reflex` + `@rbxts/react-reflex`), not charm.
- **Trig.** The sim never calls `math.sin`/`math.cos`: bullet bursts read a table of V8's exact values
  (`fixtures/arc-table.json`); the Dungeon Forge uses `shared/dungeon/forge/trig.ts`, a correctly rounded sin/cos
  that gives identical results on every Roblox client and server (platform libm does not). Cost: 2 of 20,000 tested
  MVP seeds (706, 10186) lay out differently from the web build, because V8's sin is 1 ulp off there. Exact parity
  for every seed would need a port of V8's LGPL glibc sin/cos; not done.
- `JSON.parse` syntax-error wording in `deserializeRecording` differs from V8's (not covered by fixtures).
- **Solid pillars on endless floors (docs/DECOR.md D2).** Endless floors set the Kaleb-Vale Forge option
  `solidPillars` (`endlessFloorParams`): after decoration every pillar cell becomes WALL (cover against bullets and
  sight), and the room enemies' walks (`walkToward(..., STEER)`, never the boss) use `SimConfig.actorSteerMover`
  (`actorSteerMover`) to round them; it only differs from `moveCircle` at pillars and clipped wall ends. M1
  (`KALEB_VALE_MVP_PARAMS`) and every fixture leave both off and replay exactly as before; endless replays changed.
- **Double-size rooms on endless floors.** Endless floors set the Kaleb-Vale Forge option `roomScale` to
  `ENDLESS_ROOM_SCALE` = 2 (`endlessFloorParams`): every rolled room width and height, `minCombatRoomSize` and the
  scatter radius are doubled (4x the floor area; corridor lengths stay about the same). No extra rng draws; 1 or
  undefined is the unscaled floor exactly, so M1 and every fixture are unchanged; endless layouts and replays changed.
  Room encounter budgets are unchanged, so the same enemies spread over more floor.
- **Slower, longer sword (port retune).** `SWORD_DATA`'s swing recovery, finisher wind-up and finisher recovery are
  `SWORD_TEMPO_PERCENT` = 120% of the web build's (`WEB_SWORD_TIMINGS` 12 / 9 / 21 -> 14 / 11 / 25 ticks, rounded);
  the lunge keeps its distance over the longer wind-up. The knight's attack animations stretch over these timers, and
  the swing fan / blade visuals (`WEAPON_VIEW` swing / finisher show, blade sweep) are 20% longer too. Swing and
  finisher reach are `SWORD_REACH_PERCENT` = 115% of the web build's (1.7 / 2.2 -> 1.955 / 2.53; the guard keeps 1.9),
  so the fan and blade, drawn from the swing's radius, are 15% larger. Every golden fixture was recorded with the web
  sword, so the parity specs (golden runs, validate / segments, constants, the boss TTK table) replay under
  `setSwordTimings(WEB_SWORD_TIMINGS)` (timers and reach) and still match bit for bit; live play (every world) and
  live replays use the port's sword.
- **Longer score combo (port retune, 2026-10-30).** `COMBO_WINDOW_SECONDS` 3 -> 6 (`COMBO_WINDOW_TICKS` 180 -> 360,
  `shared/sim/score/scoreData.ts`); Lingering 4.5 s -> 9 s (+3 s) and Impatience -1 s -> -2 s (`progressionData.ts`),
  so both keep their share of the window; strings `boon.lingering.desc` / `curse.impatience.desc` follow. A sim change:
  every scored run (endless, `KV_Scoring` M1, the tutorial) replays and scores differently from older builds; no
  fixture is scored, so every fixture still matches. The HUD meter reads the window from the snapshot (unchanged code).
- **One-hit swarmers (port retune, 2026-10-31).** The swarmer's hp is `SWARMER_HP` = 1, the web build's
  `WEB_SWARMER_HP` 2 minus one (`archetypes/swarmer.ts`; endless hp scaling, party scaling and the boss's swarmer adds
  all start from it). A sim change: M1, the tutorial, endless and the bosses' adds play differently from older builds.
  Every golden fixture and the web-tuned specs (golden runs, validate / segments, constants, the boss TTK table,
  `bossAct1.spec`, docs/M1.md's tuning table) replay under `setSwarmerHp(WEB_SWARMER_HP)` next to
  `setSwordTimings(WEB_SWORD_TIMINGS)` and still match bit for bit; `enemies.determinism.spec` pins the port's current
  outcomes separately.
- **Archetype bands.** Kinds number by (`ArchetypeDef.band`, then id order), not id order alone. The web build's
  archetypes are band 0 (indices 0..6, pinned by hashed golden runs); a port-only archetype takes a NEW band so it
  numbers after the web table and no web index ever moves. The training dummy is band 1 (`PORT_BAND_TUTORIAL`),
  index 7 (`shared/sim/combat/actors/registry.ts`).
- **`enemy.dummy`.** The theme contract's `ENEMY_ARCHETYPES` gained `dummy` after the web build's six: every pack
  must fill `enemy.dummy` (asset and colour role) and `enemy.dummy.name` (placeholder: a post).
- **Decor and breakables in the theme (docs/DECOR.md R2, R13).** Two port slots. `decor.*` is optional (no
  placeholder kind; `decor.delve.b<n>.<kind>[.<v>]` with a lowercase kind segment, `decor.fx.<name>`,
  `decor.fx.ambient.b<n>`; free-size art with `layer` / `pivot` / `glow` / `emissive`), rebuilt from the plan since the
  web DECOR source was not at hand. `breakable.*` is required: every pack fills `breakable.barrel` / `breakable.crate`
  (asset, colour role, `.name`; placeholder: low boxes), `sfx.breakable.hit` / `sfx.breakable.break`, and the
  `decor.fx.*` colour roles, which the validator keeps >= 40 CIE76 Delta E from the enemy-bullet roles.
- **Tutorial (docs/TUTORIAL.md).** `SimConfig.tutorial` is an opt-in harmless mode (hits land but never cost hearts or
  armor, optional wounded start) with its own `tutorial` hash group appended after `party`; without it nothing
  changes and every fixture matches. The `tutorial` world is registered for the client's local build only: the server
  refuses it (`shared/run` `SERVER_REFUSED_WORLDS`) and it is never submitted or posted. "Has played the tutorial" is
  a per-player doc in DataStore `KV_Onboarding_v1` (`OnboardingService`, codec in `shared/onboarding`). Its floors are
  endless floors with fixed seeds (`tutorialForgeParams` = `endlessFloorParams` + seed / room count, world from
  `endlessFloorWorld`), so endless Forge options (solid pillars, `roomScale`) apply; a layout change fails its lock spec.
  Blocking is mandatory (TUTORIAL.md Decisions 9): `TutorialSimConfig.guardLock` holds combat D's bruiser at 1 hp until a
  sword guard erases a bullet (hashed fields appended to the `tutorial` group; tutorial replays changed, no fixture did).
  A first join (onboarding loaded and not done, or `KV_Tutorial`) starts it before, instead of, the main menu; Skip
  leaves like Leave run (back to the menu), the outro's Start my first run is Play solo, and the main menu has the
  replay. A player in it is busy for lobbies (`RunSessionService.busyReason`), so no lobby start takes it over.
- **Breakable clutter on endless floors (docs/DECOR.md D4).** Endless floors get barrels and crates
  (`shared/dungeon` `placeBreakables`, on `EndlessFloorLayout` / `EndlessFloorWorld.breakables`): placed after the
  Forge from their own stream (`floorSeed ^ BREAKABLE.salt`), so layouts, digests, props and room spawns stay put; they
  keep clear of the party's own spawns (so pieces depend on the party size) and their cells leave `roomSpawnTiles`.
  Endless runs set `SimConfig.breakables` (`BREAKABLES_CONFIG`): `state.breakables` (per piece kind, cell, hp, broken
  tick) with its own `breakables` hash group appended last; the movers and the bullet blocker take an optional trailing
  `solid` (`SolidCells`) the sim passes from state (absent: exactly the grid-only path); they block bodies and every
  bullet but not sight, break under player bullets / sword swings / enemy bullets / the boss's slam, and a player's
  break scores the appended source `BREAKABLES` (no combo). M1 (`KALEB_VALE_MVP_PARAMS`), every fixture and the
  tutorial (no `breakables`, B7) play exactly as before, but the appended source widens every scored run's `score`
  hash group by `score.points.breakables` / `score.counts.breakables` (always 0 there), so the tutorial's and a
  `KV_Scoring` M1 run's state hashes differ from older builds (no fixture is scored); endless replays and scores
  changed. Mother Bramble's slam rule is nearly dormant: boss rooms get no pieces, so it only reaches one in a room
  that touches the boss room (1 of 240 boss floors, run seeds 1-60 x floors 5-20).
- **Enemy outlines (docs/OUTLINE.md).** Presentation only (no sim, hash or replay change). A new colour role
  `enemyOutline` (validated >= 3:1 on every biome floor and wall, CIE76 >= 40 from the enemy-bullet roles). Placeholder
  enemies and bosses sit under `KV_Actors/Enemies`, a Model with ONE `Highlight` (never one per actor: the engine
  draws at most 31); corpses move to `KV_Actors/Corpses`. Sprite enemies draw a baked `<sheet>-outline.png` (from
  `art/atlases.json` `outline`) in a second ImageLabel behind the frame. The skeleton's `pad` went 1 -> 3 (cells 98x74),
  so its atlases were re-uploaded with the two outline sheets (`assetIds.ts`).
- **Sprite effects and audio (docs/FX_AUDIO.md).** Source: the Ninja Adventure pack's FX and Audio folders (CC0),
  in gitignored `art/vendor/ninja-adventure/`. Theme port additions: sound assets take `variants` / `pitch` /
  `minInterval` (not on looped `music.*` / `amb.*`); `PORT_AUDIO_EVENTS` (the old `PORT_SFX` plus 13 new IDs) and
  `amb.b1`..`b5` are required (SILENT in the placeholder); an optional `fx.*` slot (one-facing sprites, `play`
  animation, `sizeTiles` <= 3, `tint` / `meanColor` >= 40 CIE76 from the enemy-bullet roles) and the `fx.heal` /
  `fx.curse` roles. `npm run audio:build` (`art/audio.json`, `art/audio.lock.json`) makes `art/build/audio/*.ogg` and
  `packs/vale/audioLayout.ts`; `art:build` also makes the `fx-effects.png` atlas and ambient flipbooks
  (`packs/vale/fxLayout.ts`). A vale sound turns on once every one of its files has an id; effects once the atlas has
  one. Effects are drawn flat on the floor (`FxSpriteController`), under markings and bullets; bullets keep their
  neon placeholders. `decor.fx.ambient.b<n>`: main's R5 mote (`decor-mote.png`) wins once uploaded; the Ninja
  Adventure flipbooks (`fx-ambient-b<n>.png`) only fill a biome it leaves empty. Presentation only: no sim, dungeon or
  hash change.
- **Second endless boss (docs/BOSS_DEMONLORD.md D3-D5).** `boss.demonlord` (the Demon Lord, a hunter: chase +
  cleave, 3-gap hellfire ring, double cleave, brimstone charge, swarmer summons) is band 2 (`PORT_BAND_BOSSES`, index
  8; no web or dummy index moves), on the fight skeleton moved out of act1 into `boss/shared.ts` (a pure move: the
  golden boss runs match bit for bit). His two new burst shapes are port shapes (`combat/arcTablePort.ts`: sin / cos
  from the Forge's deterministic `dsin` / `dcos`, merged into the arc lookup; `fixtures/arc-table.json` and
  `arcTable.ts` stay the web build's). Each endless boss floor picks its boss with `bossKindFor(floorSeed)`: one draw
  from its own stream `mulberry32(floorSeed ^ BOSS_PICK.salt)` (salt `0x27d4eb2f`), weighted by `ENDLESS_BOSSES` (50 /
  50; `shared/dungeon` endlessData.ts), stored as `EndlessFloorLayout.bossKind`; layouts, digests, props, room spawns
  and breakables are unchanged. Score tables give him Mother Bramble's 5000 points and final phase 3. M1
  (`KALEB_VALE_MVP_PARAMS`), every fixture and the tutorial keep Mother Bramble and replay exactly as before; endless
  replays and scores changed on every floor that picks the Demon Lord (run 1337's floor 5 among them).
  `node scripts/find-boss-seed.js` lists run seeds per boss. D6 added one port audio ID, `sfx.boss.taunt` (required in
  every pack via `PORT_AUDIO_EVENTS`, SILENT in the placeholder): a taunting boss's phase change (the Demon Lord's,
  `BOSS_TAUNT_IDS`) plays it instead of the roar, which it falls back to while silent.
- **Co-op spectating (docs/SPECTATE.md).** Presentation only (no sim, lockstep, server, hash or replay change). A dead
  party member watches a living teammate and cycles with Attack / Alt; `SimController.getViewPlayerIndex()` replaces
  the local index in the camera, weapon view, bullet transparency, actor ring and audio, and `SnapshotExtras.vitalsIndex`
  drives the HUD's vitals (personal fields keep `playerIndex`). A dead client's co-op frames carry EMPTY_INPUT (debug
  bits kept under KV_Debug), which changes the hashed `prevButtons` of the dead player but cannot desync (every client
  steps the same merged log). Tunables `SPECTATE` in `shared/view/spectateConfig.ts`.
- **Boost drops (docs/BOOSTS.md).** `SimConfig.drops` (endless: `DROPS_CONFIG`; tutorial: `guaranteedDropsConfig`,
  a Fury on combat B's last kill) adds `state.drops` with its own `drops` hash group appended after `breakables`
  (last) and its OWN rng stream (`seed ^ DROPS.salt`), so no main-stream draw moves. Kills roll in `killActor`
  (never turrets, the dummy, the boss, a boss floor's boss room, or any kill while a boss fight is on: the Demon Lord's
  adds can land outside the room's bounds); pickups are the first living player (index order)
  in range; Fury / Frenzy go through `playerHitDamage` / `attackTicks` (Frenzy as one integer percent with Swift
  Strikes), Quickstep scales the walk, Aegis is a pip in `state.drops` taken before armor. A port input bit
  `DEBUG_DROP_BUTTON` (32768, key Semicolon since docs/MINIMAP.md MD11 (was M), KV_Debug only) joins `PORT_BUTTONS`. Theme: `boost.<kind>` (required, placeholder
  `"Diamond"`), `sfx.boost.*` in `PORT_AUDIO_EVENTS`. M1 and every fixture are unchanged; endless and tutorial
  replays changed.
- **Demon art (docs/DEMON_ART.md, docs/BRAMBLE_ART.md).** Presentation only (no sim, dungeon, hash, replay or
  fixture change). Source: the 2D Demons - TopDown asset pack v1.1 by SmallScaleInt (Standard Commercial License,
  `THIRD_PARTY_NOTICES.md`) in gitignored `art/vendor/demons-topdown/`.
  Pipeline: a grid source may list `source.layers` (sub-folders, bottom to top: `["Shadows", ""]` = the body over its
  shadow; `Effects/` is dropped, its swipes read as bullets), and a set may say `"cells": "perSheet"`: each sheet
  trims to its own animations and carries its own `frameW` / `frameH` / `pivot` (theme `SpriteSheetImage`, accepted in
  the actor slots only, `SlotContract.perSheetCells`; `SpriteView` re-places the billboard per sheet). The boss
  contract gained optional `attack.2` / `attack.3` / `attack.4` / `intro` / `taunt`; an actor attack in `shared/view`
  names its animation and plays segments of it (`ActorAttack.anim` / `segment` / `loop`, `ActorSpecial`, `flinch`),
  split at `SPRITE_ANIM_MARKS` (fractions of the frame count, measured on the art). Two sets: `enemy.bruiser` = Demon
  Beast 3 (the knight's density, 3 sheets + rims) and `boss.act1` = Demon Elite 3 (`bodyTiles` 2.5, 7 sheets + rims);
  both uploaded 2026-10-26 (ids in `assetIds.ts`), so the bundled vale pack draws them. Phase 2: the turrets
  `enemy.sprayer` = Demon Spawn 8 and `enemy.caster` = Demon Spawn 11 (idle / hit / death, 2 sheets + rims each; move
  and attack alias idle's cells, `turretSpriteInputOf`); their staff glow is baked semi-transparent into the body
  sheet, so the grid source's `source.layerNoiseAlpha` (`{ "": 254 }`) clears a layer's faint pixels before
  compositing (DD7). Uploaded 2026-10-30 (DA13), so the bundled vale pack draws them.
- **Room edges (docs/ROOM_EDGES.md).** Presentation only (no sim, hash, replay or fixture change). Three required theme
  colour roles `roomEdge.safe` / `.waiting` / `.live` (`ROOM_EDGE_ROLES`; waiting and live >= 3:1 on every biome floor,
  all three >= 40 CIE76 from the enemy-bullet roles and `telegraph`, `roomEdgeReport`). shared/sim score exports its
  room predicates as `scoreRoomEngaged` / `scoreRoomDown` (renamed, unchanged) so the view's unscored-M1 fallback
  judges rooms exactly as scoring does. `DisplaySettings.roomEdges` (default On, only Off stored; settings doc stays
  v2). `DashStyle.liftStuds` is optional (absent: every existing marking layer unchanged).

- **HUD layout (docs/HUD_LAYOUT.md).** Presentation only (no sim, hash, replay or fixture change). `Text` with no
  `width` sizes to its content (`fill` / `wrap` take the parent's width): a scale-width Text in an auto-sized `Panel`
  had stretched the status and weapon panels across the screen. Always-on panels are corner `Panel`s held to
  `HUD_FOOTPRINT` boxes outside `HUD_CLEAR_ZONE` (footprint.spec.ts); the info line (title / biome / seed / dungeon) is
  in the pause overlay and run-over panel only; the swap hint and verdict lines are timed (`HUD_HINTS`); corner panels
  fade under the action (`HudOcclusionController`, CanvasGroup + bindings). Settings: `DisplaySettings.hudFade`
  (default On, only Off stored, document stays v2) and a 70 % step in `HUD_SCALE_PERCENTS`; one new theme string
  `hud.items.more` and `options.display.hudFade`.
- **Game feel pass (docs/FEEL.md).** Presentation only (no sim, dungeon, hash, replay or fixture change; lockstep
  behaviour unchanged). Hurt feedback on the view player (`StateWatch.hurtKind`, moved from the audio watch to
  `shared/view/watch.ts`): red screen edges in `uiHealth` (`HurtFlashController`, <= 1.33 Hz by `HURT_INVULN_TICKS`), a
  2-texel `hurt` nudge, a 40 ms solo freeze; a 1 Hz low-health edge pulse while one more hit kills. Heavy hits: 40 ms solo
  freeze + `heavy` nudge. Enemy hits: rim flash in `uiText`, a sprite hold, a 1-2 texel push (`hitReact.ts`;
  placeholders flash under ONE more Highlight, `KV_Actors/Flashing`); squash & stretch (sprite views, whole art pixels)
  and roll / brimstone-charge afterimages (`KV_Actors/Ghosts`). Juice setting `screenShake` (default On, overrides-only;
  `screenShakeOn` = it and not reduced motion), string `fx.settings.screenShake`. Co-op now drains the hitstop clock
  every frame (it was never drained, freezing particles after the first kill). No theme contract change.
- **Asset preloading (docs/PRELOAD.md).** Presentation only (no sim, dungeon, hash, replay or fixture change). A join
  loading screen (`LoadingController`, display order 30: the cursor must sit above it) holds until the core tier
  (`PRELOAD.core`: UI, knight, regular enemies, every sfx, breakables, boosts, fx, decor, biome 1, menu / lobby / floor 1
  / tutorial music) resolved, Skip (after 3 s) or 15 s; `PreloadController` (loadOrder 1) then loads the later tier
  (bosses, other music, ambience, biomes 2-5) on one queue that AudioController and the boss floor push use (each
  content id once per session). The first-run gate's decision fires only once the screen released. Theme: `contentIds`
  / `assetIdList` / `biomeContentIds` on `ThemeCore` / `ThemePack`; three required strings `loading.title` /
  `.progress` / `.skip`. Entries are never-parented ImageLabels / Sounds (D4) until the P0 spike says strings work.
  `KV_SkipLoading` skips the screen.
- **Minimap with fog of war (docs/MINIMAP.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or fixture
  change). Pure core in `shared/view/minimap` (map tiles, symmetric shadowcasting sight, `FogOfWar` with a shared party
  map from every living player, the camera-turned map transform, RGBA painting into a `buffer`); `MinimapController`
  shows one `EditableImage` per floor in the bottom-right corner panel (140 x 140, so the HUD cover cap
  `maxCoverShare` went 0.12 -> 0.145, MD7), a full-map toggle and the solo pause overlay. Theme: required colour roles
  `MINIMAP_ROLES` (`minimap.*`, validated by `minimapReport` on the plain and room-tinted map floors and `uiPanel`).
  Settings: `DisplaySettings.minimap` (default On, only Off stored, doc stays v2). Input: a rebindable non-sim
  `GameAction` `map` (M / D-pad left; a stored override on a new action's default makes the new action yield instead
  of dropping overrides); the KV_Debug boost-drop key moved M -> Semicolon (MD11). Studio check and the M0 spike pending.
- **Stage loader (docs/STAGE_LOADER.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or fixture
  change). Run starts and floor changes are covered (`StageController`, loadOrder 2, `StageCard` at the loading
  screen's display order 30, drawn in the event frame through React bindings); SimController defers its run-start /
  floor-change work one item per frame behind the cover (build the run, listeners, pre-gen) and holds a solo run start
  (no tick, nothing recorded) until the reveal. Floor n + 1 is pre-generated through `ctx.endlessFloor` during floor
  n's boon draft (floors are pure in the run seed, so the cached world is the one the sim would build). Co-op is never
  held and its client is still built in the `partyRunStarted` frame. Input is neutral under the cover and through the
  fade. Five required strings `stage.*`; the MenuLayer "Starting run..." panel and `game.starting` are gone.
- **Roblox invites and parties (docs/INVITES.md).** No sim, dungeon, lockstep, hash, replay or fixture change. Lobby
  invites gain `source` (`server` / `platform` / `party`): `Lobbies.platformInvites` records the friends picked in
  Roblox's invite prompt (absent players only, 15 min, cap 20 per member, apart from the in-server 60 s / 4) and
  `partyInvite` (no cap) serves Roblox Party grouping. `InviteService` opens `SocialService:PromptGameInvite` with
  LaunchData from `shared/invite` (`kv1|l|<lobbyId>|<userId>` / `kv1|g|<userId>`, never trusted: Closed entry needs an
  invite record) and resolves every arrival with the pure `resolveArrival` (invite > LaunchData lobby by `canAccess` >
  `followed` > party mate's lobby / a new Closed party lobby > `inviteArrived`); `joinIntent` (may upgrade none ->
  lobby / party) lets invited and party arrivals skip the automatic first-run tutorial (`FirstJoinGate`).
  `INVITE.promptSide` ("server", falls back to the client) and every API fact wait for spike I0 (`KV_InviteSpike`,
  docs/SPIKES.md) in a published place: none of these APIs work in Studio, which uses `KV_FakeLaunchData` /
  `KV_FakePartyId` / `KV_FakeInviteEligible` / `KV_FakeInviteRecipients` (Studio only). Ambient types for the party API
  in `src/types/roblox-social.d.ts`. Notification String ids (I8) go in `INVITE.notificationStringIds`.
- **Player outline (docs/PLAYER_OUTLINE.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or fixture
  change). A new required colour role `playerOutline` (`#f4f1ea`, `minimap.self`'s; validated >= 3:1 on every biome
  floor and wall and the darkest band, CIE76 >= 40 from `PLAYER_OUTLINE_DIFFERENCE_ROLES`: enemy bullets, telegraph,
  `enemyOutline`, every boost, `playerOutlineReport`). Only the watched player (`getViewPlayerIndex`), alive
  (`shared/view` `playerOutlined`, `PLAYER_OUTLINE`). Sprites: the knight's 1 px outline sheets; the atlas pipeline's
  `outline` gained opt-in `clipAtCellEdge` (the pad rule is lifted, the rim stops at the cell edge, the build prints the
  clip) because its 128 px cells already fill the 1024 atlases; its body sheets stayed byte-identical (ids unchanged),
  the 8 `vanguard-*-outline.png` were uploaded 2026-10-28. Placeholders: `KV_Actors/Players/Outlined`, one more
  Highlight (Occluded). Settings: `DisplaySettings.playerOutline` (default On, only Off stored, doc stays v2), string
  `options.display.playerOutline`; debug attribute `KV_PlayerOutline`. Studio check pending.
- **Mobile play (docs/MOBILE.md).** Input and presentation only (no sim, dungeon, lockstep, hash, replay or fixture
  change). Touch is a third device in `mapDevicesToInput` (`DeviceSnapshot.touch`, `InputDeviceKind` / `AimDevice`
  `touch`); `shared/play/touch` holds the pure state machine (`TouchControls`: floating move stick, Attack / Alt action
  sticks with a centre auto-target and a 0.25 s aim latch, buttons, draft taps), `pickAutoTarget`, the draft helpers and
  `touchMode`; `shared/view/hud` `touchLayout` places the controls. `TouchControlsController` draws them (stock touch
  GUI off, `LandscapeSensor`). On touch: HUD scale floor `HUD_VIEW.touchMinScale`, no weapons panel or corner minimap
  (the full map from the pause / party overlay, tap to close), the tutorial prompt at the top. Settings
  `DisplaySettings.touchSize` / `touchOpacity` / `touchAutoTarget` / `touchLeftHanded` (overrides-only, doc stays v2).
  Required strings `TOUCH_STRING_KEYS`. Spike `KV_TouchSpike`. Device checks pending.
- **Room clear celebration (docs/ROOM_CLEAR.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or
  fixture change). `RunView.roomClears` (`shared/view/fx` `RoomClearEvents`, collected per tick like the boost events)
  diffs `state.score`'s room records and per-source points; `RoomClearSequence` / `ScoreRoller` (pure) drive
  `RoomClearController`: solo slow motion (0.5x, `applyRoomClearSlowMo`), a co-op last-kill hold, a spark ring, the
  CLEAR / PERFECT stamp and one tally row (`HUD_TRANSIENT.roomClear`, the boss bar's slot), a far co-op clear's corner
  chip (`roomClearChip`, new `TransientAnchor` `topRight`), the score panel's rolling number (`Text` takes a binding).
  Juice setting `roomClear` (default On, overrides-only, doc stays v2); required strings `ROOM_CLEAR_STRING_KEYS`
  (`room.clear.*`); port audio IDs `sfx.room.perfect` / `sfx.score.tick` / `sfx.score.land` (SILENT in the placeholder);
  the `stamp` nudge. `REQUIRED_STRING_KEYS` is built inside a function: `contract.luau` sits at Luau's 200-locals
  limit, so never add top-level constants to contract.ts without checking it compiles under Lune. Studio check pending.
- **Combo you chase (docs/COMBO.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or fixture change; the
  multiplier and its scoring are untouched). Tiers on the sim's tenths: x2 RAMPAGE, x3 CARNAGE, x4 DOMINATING, x5
  UNSTOPPABLE (`COMBO_TIERS`). `RunView.combo` (`ComboEvents`, per tick) feeds `ComboDisplay` (ScorePanel's combo row
  and 10 px meter, same five rows: 158 of 160) and the cue mapper: `sfx.enemy.death` climbs with the combo (+5 / +8 /
  +10 / +12 semitones at x2-x5, per-cue speed replacing the jitter, rank 55 in a streak), `sfx.combo.tier` per
  crossing, `sfx.combo.break` only when the timer runs out while `fightOn` (a lapse after a clear is silent and quiet);
  no combo sound under the stage cover or after run over. Theme: five required colour roles `COMBO_ROLES`
  (`comboReport`), six strings `COMBO_STRING_KEYS`, two port audio IDs (SILENT in the placeholder; the break clip is
  the owner's Pixabay MP3 in gitignored `art/vendor/pixabay/`). The tier-up floor shout is a SurfaceGui under every
  bullet (sprite effects' floor placement), <= 55 % opaque, ducking near enemy bullets. Nudge kind `comboBreak`.
  Debug `KV_ComboDebug`. No setting. Clips uploaded 2026-10-30 (vale `assetIds.ts`); Studio check pending.
- **Grazes and parries (docs/GRAZE_PARRY.md).** One unhashed sim feed, otherwise presentation only (no hash, replay,
  fixture, rng, score or lockstep change): `ScoreEvents` gained per-tick `grazeX/Z/VX/VZ/Player` (pushed by
  `scoreBulletVisit`'s new trailing `grazer`) and `guardX/Z/Player` (the guard passes `sweepArc` a trailing
  `ArcEraseSink`), like the kill pops' `popX`. `RunView.nearMiss` (`NearMissEvents`, per tick) feeds the ONE
  `NearMissDirector`, owned by the client's `NearMissController`, whose `onFrame` subscribers are the sparks
  (`DeathParticleSystem.graze` / `.parry`, kinds 3 / 4), `ParryFlashController` (PARRY! floor text on the combo
  shout's construction, 1.2 tiles screen-down, solo 30 ms freeze through the hitstop clock) and AudioController (its
  whole sound frame now runs as that subscriber). Theme: colour roles `nearMiss.graze` / `.parry` (`nearMissReport`),
  strings `fx.parry.text` / `.count`, port audio IDs `sfx.player.graze` / `sfx.player.parry` (SILENT in the
  placeholder; a silent parry leaves today's deflect untouched). contract.luau / validate.luau sit at 196 / 200 of
  Luau's 200 top-level locals with the draft reveal merged (counted as written; `checkSlice` is a closure in
  `validateAsset` to stay there). Scored runs only. No setting. Debug `KV_ParryDebug`. Clips uploaded 2026-10-30 (vale graze Magic5, parry Bonus); Studio check pending.

- **Draft reveal (docs/DRAFT_REVEAL.md).** Presentation and client input only (no sim, dungeon, lockstep, hash, replay or
  fixture change). The boon draft's cards deal face down and flip one by one (`DraftReveal`, pure, in shared/view/hud);
  rare cards chime, a legendary flips last after a charge (others dim, music dips, the back's skull eyes light, a
  pitch-up ladder of `sfx.draft.charge`), a hush and a flare, then keeps a halo; a press skips; a pick stamps. The
  client holds the confirm (`DraftRevealGate`, shared/play) while the reveal plays or before it has begun for an open
  local draft (the sim's `DRAFT_MIN_OPEN_TICKS` is untouched: the sim just sees the press later). Theme: three required
  roles `boon.common` / `.rare` / `.legendary` (`BOON_RARITY_ROLES`, `boonRarityReport`; `RARITY_COLOR_ROLES` uses them
  instead of the loot `rarity.*`), five port audio IDs `sfx.draft.*` (SILENT in the placeholder), ui images may carry
  `slice` (ui.* only), optional `draftSkinIds()` cut from the ToffeeCraft Horror UI sheet (paid licence,
  `THIRD_PARTY_NOTICES.md`) by new `images` options (`rect`, `cutout`, `slice`, `centre: "flat"`, `flatBoxes`, `mask`).
  `contract.luau` / `validate.luau` are at 196 / 200 top-level locals with grazes and parries merged. Debug `KV_DraftRevealDebug`. No setting. Studio check, art upload and
  sounds pending.
- **UI art (docs/UI_ART.md).** Presentation only (no sim, dungeon, lockstep, hash, replay or fixture change). The UI
  skins itself from the ToffeeCraft Horror UI sheet: 12 optional sliced ids (`uiSkinIds()`: panels menu / hud / tall,
  buttons, option bars, pill bar track / fill, slots) as their own PNGs, 27 optional icons (`uiIconIds()`: hearts,
  flasks, candle, chips, focus corner, ornament, divider, touch rings, glyphs) packed by `art:build` into ONE
  `ui-icons.png` (`uiIcons` in art/atlases.json, generated `packs/vale/uiIconLayout.ts`, all icons switch on together);
  ui images may carry a `rect` (not with `slice`). Pure logic in shared/view/hud `skin.ts` / `skinConfig.ts` /
  `hudSkin.ts` (`UI_ART`: menus 2, in-run frames 1 reference px per art px, snapped to whole screen px; padding from the
  measured `contentInsets`, not the slice insets) and shared/view/menu `skin.ts`; client primitives `SlicedImage`
  (`snap`), `ArtImage`, `FocusCorners`, `Panel` `skin`, `MenuButton` `variant` / `icon`. Without the art every screen
  is today's flat UI except two deliberate sizes: `HUD_VIEW.heartSize` 22 -> 24, `bossBarHeight` 12 -> 16. The corner
  minimap stays flat (`HUD_SKIN.minimapFramed` false: its turned map would paint over a frame). `contract.luau` /
  `validate.luau` are at 198 / 195 top-level locals (counted on out/). Spike `KV_UiArtSpike`. Upload and Studio check
  pending.
- **Enemy variants (docs/ENEMY_VARIANTS.md).** Gameplay. Four port archetypes in band 3 (`PORT_BAND_ENEMIES`, indices
  9-12; no web, dummy or Demon Lord index moves): `imp` (blink flanker: floor ring at the landing spot, 5-bullet fan, a
  port arc row 5 @ 0.7), `slime` / `slime.small` (the Ooze: goo trail of stationary `BulletKind.GOO` bullets, at most 6
  per slime by count, splits into 2 slimelets adopted into its score room), `summoner` (2 swarmers per cast, 3 alive, 6
  per life, they wither with it; fills the existing `enemy.summoner` slot). Endless rooms buy them from floors 2 / 4 / 6
  (`EndlessRoomKind.fromFloor` / `maxPerRoom`, `spendEncounterBudget(rng, budget, floor, cap)`); floor 1 spends draw for
  draw as before (`roomPool.lock.spec`). Room-enemy walks and cooldowns go through `walkStep` / `enemyCooldown`
  (`combat/actors/actorMods.ts`; exactly the raw values at 100 %). `adoptScoreRoomMember` keeps a room open for runtime
  children. Goo: per-kind hit radius (`enemyBulletHitRadius`, goo 0.35), no grazes, no guard points / parry feed (the
  guard still erases it), ordinary swings and breakables ignore it, no shoot cue (`events.gooSpawned`). Elite affixes
  (Hulking / Swift / Shielded / Vengeful): assigned after the Forge from their own stream (`AFFIXES.salt` 0xcc9e2d51,
  `roomAffixes` on the floor), opt-in `SimConfig.affixes` (endless only), `state.affixes` with its own hash group
  `affixes` appended LAST (after `drops`), stamped in `spawnActor` before `init` for planned spawns only. M1, every
  fixture and the tutorial replay exactly as before; endless replays and scores changed (boards stay `_v1`). View: ring
  hints with an `attack` filter, goo floor decals (second bullet pool, `GOO_VIEW.decal`), affix floor rings / rim tint /
  name chip / shield row (never a Highlight), Hulking draw scale in the pool keys, Vengeful corpse length. Five port
  audio ids (`sfx.enemy.blink` / `.summon` / `.split`, `sfx.affix.shieldbreak` / `.vengeful`, SILENT in the
  placeholder). First sighting: optional `seen` in the onboarding doc (still v1), remote `bestiarySeen`. Vale: the LoP
  slime set built (upload pending); imp / summoner rigs pending. Studio check pending.
- **New-best celebration (docs/NEW_BEST.md).** Presentation plus one server doc (no sim, dungeon, lockstep, hash,
  replay or fixture change; scoring and the leaderboard untouched). Personal records: DataStore `KV_Records_v1`
  (`shared/records`, `RecordsService`; best score and deepest floor per board solo / coop, `{ v: 1, endless, seeded? }`),
  written only by the server from its own replay of accepted endless runs (deaths AND abandoned runs, private servers
  too, never Studio / debug runs, party runs as on the leaderboard), every write a max-merge inside UpdateAsync
  (`MergeKeyValue`); seeded once from `LB_Details_v1` (a stored `seeded` marker; a failed seed or load = `loaded: false`,
  retried next join). Remotes `requestRecords` / `records(RecordsStatus)`, `RunFinishVerdict.records` (per recipient).
  The client freezes a per-run baseline (records + earlier runs still awaiting their verdict, `pendingRunClaims`) and
  tracks the SHOWN score (`FX_FRAME_PHASE.scoreRoll`: RoomClearController's roller before every normal frame handler).
  Theme: role `newBest` `#ffd700` (`newBestReport`), 18 strings `NEW_BEST_STRING_KEYS`, port audio IDs `sfx.best.new` /
  `sfx.jingle.record` (SILENT in the placeholder, falling back to the PERFECT / game-over jingles); `contract.luau` /
  `validate.luau` at 179 / 199 top-level locals (counted on out/). Debug `KV_NewBestDebug` (client baseline),
  `KV_FakeRecords` (Studio records fake). No setting. Studio check and the sounds' audition / lock / build / upload pending.
- **Developer mode (docs/DEV_MODE.md).** A client-only world `dev` (`shared/run` `buildDevRunConfig`, in
  `SERVER_REFUSED_WORLDS`, never submitted: `unsubmittedReason` `dev`): the endless run of a seed started on any floor
  (opt-in `EndlessConfig.startFloor` / `startDepth`; Depth = 1 + boss floors below) with god mode (opt-in
  `SimConfig.dev`: `state.dev` hashed as the `dev` group appended after `affixes`, only `builds` after it;
  `damagePlayer` lands nothing while `invulnerable`; port input bit `DEV_GOD_BUTTON` 65536 in `PORT_BUTTONS` toggles it, so `SIM_BUTTONS` is now
  114687). Access is decided by the server (`DevModeService`, `shared/devmode` `devModeAllowed`, `shared/config`
  `DEV_MODE`: master switch `enabled`, Studio, `allowedUserIds`, the user-owned place's creator) and published as the
  player attribute `KV_DevAllowed`; `DevModeController` mounts the DEV chip / panel (F2) and the god key (F3) only then.
  In a dev run R restarts at once on the same seed and floor (no forfeit); outside one R acts only once the run is over
  (`driverKeyAction`'s `RestartWindow`; the pause overlay's Restart is the mid-run way out). M1, every fixture, the tutorial, endless and
  co-op replay exactly as before (none sets `startFloor` or `dev`).
- **Builds (docs/BUILDS.md).** Gameplay. Opt-in `SimConfig.builds` (`BUILDS_CONFIG` = `BUILD_RULES`, endless only, BUD8)
  creates `state.builds` (per player boon levels, duos, counters, deals left; the proc queue) with its own hash group
  `builds` appended LAST (after `affixes` and `dev`). Three on-kill boons appended to `BOONS` (Chain Spark / Volatile / Soul Shards,
  indices 12-14); `drawBoonOffers` draws from the classic 12 only (`CLASSIC_BOON_COUNT`), so the tutorial's floor-2 draft
  is unchanged; builds runs draw `drawCardOffers` and grant through `grantCard` (levels II-III, the evolution at III,
  duos, a double draft after every boss floor). Card ids in `draftOffers`: a boon index, or `DUO_CARD_BASE` (64) + the
  duo index (`cardDisplay` decodes them for every reader). Effect bullets reuse the player pool: `BulletKind` 8-11
  (`BURST` / `SHARD` / `EMBER` / `SPARK_BOLT`, no payload layout change) and payload sources from `BUILD_SOURCE_BASE`
  (128) up (128 + effect x 4 + generation; weapon sources stay 1..127). Procs queue on `damageActor`'s kill line (never
  in `killActor`: withers, boss sweeps, revivers and debug kills never proc) and resolve in `stepBuilds` (stepCombat
  phase 6b) under `GEN_MAX` 3, `procsPerTick` and a per-player effect budget that keeps `effectWeaponReserve` (32)
  slots per player free for weapon fire. `ScoreSource.JACKPOT` (9) is a build-only score source: its points / counts
  entries exist only with `SimConfig.builds`, so every other scored run's `score` group is unchanged. Port arc rows 8
  and 12 @ FULL_RING (`combat/arcTablePort.ts`); `BulletSimulation.setVelocity` (Soul Swarm). Theme: colour roles
  `boon.evolved` / `boon.duo` (the boon rarity report) and `build.spark` / `.burst` / `.shard` / `.ember`
  (`buildReport`: >= 40 CIE76 from every danger and boost role), 7 required strings (`BUILD_STRING_KEYS`; per-boon / per-duo strings via
  `progressionStringKeys`), 4 bullet visuals, 9 port audio IDs `sfx.build.*` (SILENT in the placeholder); setting
  `DisplaySettings.buildFx` (Full / Reduced, only Reduced stored, doc stays v2). No Luau-locals change. M1, every
  fixture and the tutorial replay exactly as before; endless replays and scores changed (boards stay `_v1`, BUD9).
  Studio check, art (BU11) and audio (BU12) pending; tuning measured (BU13, owner calls open).
- **Daily dungeon and seeded rosters (docs/DAILY.md).** Gameplay (dungeon) plus a server feature. Every endless run's
  seed picks its room enemy kinds (`shared/dungeon` `endlessRoster`: swarmers + 1 seeded kind on floor 1, one more every 2
  floors within the unlock floors, own stream `runSeed ^ ROSTER.salt` 0x165667b1; `roomKindOpen` closes the others with
  no draw); layouts, digests, props and boss picks are unchanged, room spawns (and so breakables and affixes) change:
  endless replays and scores changed from floor 1 (boards stay `_v1`); M1, every fixture and the tutorial replay exactly
  as before (`roomPool.lock.spec` keeps the no-roster digests). A `daily` world (`buildEndlessRunConfig`, no sim, hash or
  lockstep change) seeded by the server only: HMAC-SHA256 with a 256-bit key in `src/server/config/daily.ts`
  (`shared/crypto`; ESLint blocks shared / client imports of `server/*`), one seed per UTC day, `session.daily = { day,
  ruleset }`. Day-scoped OrderedDataStores `LB_Daily_Solo_v1` / `LB_Daily_Coop_v1` (scope `d<day>_r<ruleset>`, no details
  doc), histogram shards `LB_Daily_Hist_v1`, `dailyStatus` (`mine`, `podium`), `RunFinishVerdict.daily`; daily runs never
  post to the all-time boards and never write endless records (`policy.dailyWorlds`, DSD6). Client: Daily card, podium,
  lobby world toggle, leaderboard tabs, in-run rank layer, run-over daily block; strings `ROSTER_STRING_KEYS` /
  `DAILY_STRING_KEYS` / `DAILY_RANK_STRING_KEYS`, port audio IDs `sfx.rank.up` / `sfx.friend.passed` (SILENT in the
  placeholder). Telemetry `daily_*` and an optional `daily` field in `KV_Records_v1` (still v1). Debug `KV_Daily`,
  `KV_DailyRankDebug`, Studio `KV_FakeFriends`. DS0 spike and Studio check pending.
- **Localization (docs/LOCALIZATION.md).** Presentation and tooling only (no sim, dungeon, lockstep, hash, replay,
  fixture or score change). `shared/l10n`: `LOCALES` (English live; the 17 targets and pseudo-locale `en-XA` hidden
  until each passes the LD12 gate), `pickLocale` / `resolveLocaleState` (Roblox ids `[Player.LocaleId,
  RobloxLocaleId]`, then Options > Display > Language, `DisplaySettings.language`, overrides-only, doc stays v2; hidden
  locales only as a developer's explicit pick), locale number formatting (ASCII digits), `L10N_FONTS` (provisional until
  spike L0). Generated tables `shared/theme/locales/` (`key -> [text, sourceHash(English)]`, FNV-1a 32; never edit by
  hand): `ThemePack.setLocale` uses an entry only while its hash and placeholders match the current English, else
  English (listed by `localeReport()`). Developer keys (`playtest.*` but the run-over labels, `hud.debug*`) and `fx.cap`
  stay English (`isTranslatableStringKey`). Every root GUI is created through `client/ui` `createKv*Gui` or has
  `AutoLocalize={false}`, and code never upper-cases text (`check:autolocalize`, in verify). New strings need a context
  entry in `l10n/context.json` (`l10n:check`, in verify via `test:l10n`); the cloud round trip is `npm run build`,
  `l10n:export`, upload / download in the Creator Hub, `l10n:import` with the whole table. English rewordings (LD7):
  `hud.draft.waiting`, `hud.toast.fang`, `daily.result.entrants`, `daily.board.total`, `stage.best.toGo`
  (`stage.best.oneToGo` removed); display names now draw in the `name` font. Spike `KV_L10nSpike`, debug
  `KV_LocaleAudit`. L0 spike, Creator Hub steps and Studio check pending.

- **Tutorial analytics funnel (docs/TUTORIAL_FUNNEL.md).** Telemetry only (no sim, dungeon, lockstep, hash, replay or
  fixture change). A once-per-user onboarding funnel (`LogOnboardingFunnelStepEvent`: Joined -> Loaded ->
  TutorialStarted -> 16 lessons (17 since the map lesson) -> Completed, fresh players only, step 1 fields entry /
  revision) and the attempt funnel `TutorialAttempt` (replaces `tutorial`; `started` = 1, completed = 18, now 19) plus
  custom events for lesson time / hits / stuck, skip, abandon, restart, outro, gate and the new-player window (first 3
  runs, return within 7 days). Pure core in `shared/onboarding` (`PlayerTutorialTelemetry`, trackers, `read*`
  validators, `analyticsCatalog` budget spec) and `shared/tutorial` `TutorialMetrics`; remote payloads
  `tutorialStarted(info)` / `tutorialFinished(info)`, new `tutorialLesson` / `tutorialStuck` / `onboardingReport`;
  onboarding doc gains optional `firstDay` / `newRuns` / `returned` (still v1). Per-session cap 3 logged attempts / 240
  events (252 since the map lesson). Debug `KV_AnalyticsDebug`. TF0 spike, Studio checks and the dashboard (TF9)
  pending.
- **Boosts from breakables (docs/BREAKABLE_DROPS.md).** Gameplay. Some barrels and crates hold a boost: shared/dungeon
  `placeBreakableLoot` picks them per floor after breakables from their own stream (`floorSeed ^ BREAKABLE_LOOT.salt`
  0xe6546b64; per depth band 0-2 / 1-2 / 1-3 / 1-3, at most one per room, crates weighted 2 : 1, kinds by the `BOOSTS`
  weights, mirrored in `BREAKABLE_LOOT.kindWeights` and checked by a sim spec), stored as `EndlessFloorLayout` /
  `EndlessFloorWorld.breakableLoot`; layouts, digests, props, spawns, pieces, affixes and boss picks are unchanged. The
  sim draws no rng: opt-in `DropsConfig.breakableLoot` (`ENDLESS_DROPS_CONFIG`; never on `DROPS_CONFIG`, which the
  tutorial's `guaranteedDropsConfig` spreads) fills `DropsState.pieceLoot` (createSimState, nextFloor) and
  `drops/breakLoot.ts` `dropsOnBreak` (a leaf, from `damageBreakable`'s break line: any source) lands it as an ordinary
  ground drop at the cell centre, or loses it when every ground slot is taken (`events.lostLoot`); kill pity untouched.
  `pieceLoot` is hashed at the end of the `drops` group only with the flag. M1, every fixture and the tutorial replay
  exactly as before; endless replays and scores changed (all-time boards stay `_v1`, `DAILY.ruleset` 1 -> 2). View:
  `decor.fx.glint` on loaded pieces (`BREAKABLE_LOOT_VIEW`), a hop for `fromPiece` landings, a fizzle for lost loot,
  port audio ID `sfx.breakable.loot` (SILENT in the placeholder, falls back to `sfx.boost.drop`); no Luau-locals change.
  Debug `KV_LootDebug`. Loaded pieces twinkle with their own optional `decor.fx.loot` (tint role `decor.fx.glint`,
  fallback `decor.fx.glint`): the vale art is original, `scripts/art/gen-loot-glint.js` (run by `art:build` /
  `art:lock` into `art/vendor/kaleb-vale/`), packed as its own sheet `loot-glint.png` through the pipeline's new `own` on
  world sprite sets, so `decor-atlas.png` does not repack. Upload of `loot-glint.png`, Studio check, the vale clip (BL7)
  and playtest (BL9) pending.

- **Void decoration (docs/VOID_DECOR.md).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture, minimap
  or collision change; VOID cells stay VOID). Pure core `shared/view/voidDecor` (`voidField`, `planVoid` /
  `planVoidCached`: per void cell a layer, shoulder / ledge / outcrop / abyss, and a top, greedy-merged into <= 500
  columns a floor; `VOID`, `VOID_DEPTH` per decor depth band, `VOID_PIECES`, `VOID_VIEW`; salts of its own, never the
  Forge rng). `VoidController` builds one render-only Part per column (top at 0.85 x wall height, down into the
  backdrop); the backdrop moved to `VOID.abyssDepthTiles` (5; `GAME_WORLD.backdropDepthTiles` is gone) in the biome's
  abyss colour; a sparse abyss mote emitter under the floor (`DECOR_FX.abyssMote*`). Theme: every `BiomeDef` requires
  `shoulder` / `abyss` hex (`BiomeTheme` adds `ledge` = `voidLedgeColor`, `VOID_COLORS.ledgeMix`), surfaces `shoulder` /
  `cliff` join `BIOME_MATERIAL_SURFACES`, validator `voidReport` (`VOID_CONTRAST.shoulderVsFloor` 4 CIE76 and the
  shoulder nearer the wall than the floor; luminance shoulder >= ledge >= abyss; `enemyBullet` >= 3:1 on shoulder and
  ledge; abyss >= 40 CIE76 from `enemyBullet` / `telegraph`); `dimHex` moved to shared/theme `color.ts`. Decor kinds
  `flagstones` (flat) appended to `DECOR_KINDS`; optional `decor.void.b<n>.<kind>` biome kinds
  (`VOID_DECOR`, `pack.voidDecorVariants`). planDecor takes an optional `voidPlan` (source `"void"`, entries' `y` = the
  surface top, appended after every decor entry): standing pieces pass the footprint rule at their surface AND the
  far-side rule (`farSide`: their room screen-down, no walkable cell screen-up; VDD2); without a void plan planDecor is
  byte-identical. `decorPlan.ts` / `decor.ts` import `voidDecor/config` and `/layer` by file (a require cycle through
  the barrel). Debug `KV_VoidOff` / `KV_VoidDebug`. Studio checks pending.
  **VDD10 (2026-11-02): wall props are not void decoration.** The void's ruin runs (`wall` / `wallBroken`) and the
  `curb` kind (wall1) are removed, and so are R6's far-wall segments (docs/DECOR.md R6: columns only; the depth bands'
  `wallBrokenShare` gone; the `wall` / `wallBroken` kinds and vale wall2 / wall3 mapping stay, unplanned); `wall1` is
  retired art (`VALE_RETIRED_WORLD_ART`) until the next decor atlas rebuild.

- **Tutorial map lesson (docs/TUTORIAL_MAP.md).** Tutorial script, HUD and telemetry only (no sim, dungeon, lockstep,
  hash, replay or fixture change). Step `map` (11 of 17, after `ember`: open the full map), rule / marker `next` (the
  next open lesson's marker, reported as its own kind) / highlight `minimap` (the corner minimap; nothing on touch),
  `TutorialFrame.mapSeen` / `mapAvailable` (client facts: `game.map.open`, or on touch the solo pause overlay's map,
  latched only while the map prompt shows (`tutorialMapPromptShown`); `game.map.available`), `TutorialView.waived`
  (waived, not skipped, on the floor change or with the map unavailable, so the funnel keeps counting; no lesson
  report). A rule's "current" now counts steps latched earlier in the same frame. `{map}` template, three strings
  `tutorial.prompt.map.*`. Funnel renumbered (`relic` .. `finish` 12..17, `TUTORIAL_FUNNEL_REVISION` 2 = `t1r2`), event
  cap 84 / 252. Bot option `map`. Studio check and playtest pending.
- **Portrait play (docs/PORTRAIT.md).** Presentation and client input only (no sim, dungeon, lockstep, hash, replay,
  fixture or score change). Touch devices set `ScreenOrientation.Sensor` (`PORTRAIT.screenOrientation`; MOBILE.md MBD4's
  LandscapeSensor superseded). `shared/view/portrait.ts`: `cameraFraming` (the short side shows `VIEW_TILES_HIGH`,
  `PORTRAIT.maxAspect` 2.4; the camera moves back at 7 degrees, `maxDistanceStuds` caps it; upright on touch the player
  is lifted `controlBandShare / 2` of the view), read from the viewport every frame by `CameraController`;
  `backdropReachTiles` (`GAME_WORLD.backdropMarginTiles` 24 -> 28). Landscape framing is exactly as before. Upright:
  `touchLayout` keeps the controls in a bottom band (action share 0.62, move zone the lower half), `computeHudScale`
  caps touch at `HUD_VIEW.touchUprightWidth` (452) over the width, the pause map is a square on top with the panel
  under it (`pausePanelArea`, no Build list), the draft is a column (`draftSlotOffset`, `DRAFT_UI.rayY`). No new strings.
  Studio / phone check (PT9) pending.
- **3D kit decor, trial (docs/DECOR.md "3D kits").** Presentation only (no sim, dungeon, lockstep, hash, replay or
  fixture change). Props can come from 3D models rendered to sprites from the game camera by
  `scripts/art/kit/render_kit.py` (Blender `bpy`, outside npm) into `art/vendor/<kit>/`, then ordinary world art with
  `own` PNGs (the decor atlas never repacks). First kit: the Dungeon Essential Kit (Rakshaan, **CC-BY 4.0: credit
  required where players see it**, THIRD_PARTY_NOTICES.md). Two void kinds appended to `VOID_DECOR` (`cage` low,
  `chains` flat; vale `VALE_VOID_KIND_PIECES`, every biome) and the vale `bones` variant 4 is the kit's chains
  (`bones1-sw` joins `VALE_RETIRED_WORLD_ART`); the kit's candle chandelier lies fallen in rooms (`keepHeight` cuts its chain off): a
  new decor kind `chandelier` (flat, appended last to DECOR_KINDS) that no Forge piece places, laid by planDecor's
  `scatter` step (DECOR_SCATTER: one per room in about a third of the rooms, never the boss room, at most 4 per floor,
  entries appended after the void) only when the pack has its art. All five `kit-*.png` uploaded 2026-11-02; the Studio check pending.
- **3D kit decor, second kit (docs/DECOR.md "3D kits").** Presentation only. The Dungeon Modular Set V2 (C.
  Anastasiadis, **CC-BY 4.0**, on the Credits screen) gives the vale pack's `sarco` (sarcophagus), `candle` (candle
  stand) and `banner` (wall banner, 4 facings like the torch) their first art, each its own PNG; no planner change
  (the plan already placed them). Uploaded 2026-11-02; the Studio check pending.
- **Solid decor (docs/DECOR.md "Solid decor").** Gameplay (dungeon). Forge option `solidDecor` (endless only,
  `ENDLESS_SOLID_DECOR`; M1, the fixtures and the tutorial off): after solid pillars, combat / elite rooms get tombs (2
  x 1) flanked by candle stands (1 x 1) whose cells become WALL (Dungeon.solidDecor), from their own stream
  (`SOLID_DECOR.salt`), with a clear ring that keeps the floor in one piece. WorldController draws their cells as
  floor; the decor plan's `solid` step stands kinds `tomb` / `candelabrum` on them (fade box, no footprint rule).
  Endless layouts, spawns, replays and scores changed (boards stay `_v1`); `DAILY.ruleset` 2 -> 3. The endless test
  bot quantizes its axes (`quantizeAxis`: no -0, which the recording codec cannot carry). With banner art the decor
  plan also hangs up to 2 more banners per room on far walls (`DECOR_BANNERS`, presentation only). Tombs uploaded
  2026-11-02; Studio check pending.
- **Room themes (docs/DECOR.md "Room themes").** Gameplay, same option as solid decor. Every room gets a theme
  (`Dungeon.roomThemes`): the boss room a throne on its dais (4 x 2, solid) against a far wall with a red carpet (flat,
  `Dungeon.carpets`), candles and door braziers; the entrance door braziers; shrines a statue (3 x 3, solid); combat /
  elite rooms a crypt (tombs along the walls), hall (candles lining walls), store (more breakables, corner clusters) or
  plain. Wall pieces sit flush and keep 2 tiles of floor on their open sides; solidDecor.spec checks no new pinch. The
  test bots path round breakables (`pathField` `blocked`). Throne / statue / carpet art uploads and Studio check
  pending.
- **Credits screen.** Presentation only. Main menu > Credits (MenuScreen `credits`, `CreditsScreen`, Back returns to
  the menu): every work in THIRD_PARTY_NOTICES.md, by section, from shared/view/menu `CREDITS` (titles, names and
  licence lines are data in every language; section labels, "by {author}" and the change note are strings
  `menu.credits` / `credits.*`). Required by the CC BY kit and the Dungeon Forge's MIT notice. On a phone the button
  is a small one beside the invite reason (its own row would cost the smallest phone the ornament, fit.spec.ts).
- **New enemies (docs/NEW_ENEMIES.md).** Gameplay. Five port archetypes in band 4 (`PORT_BAND_ENEMIES_2`, indices
  13-17; no older index moves): `bomber` (rushes, 0.7 s fuse ring, blasts 12 @ FULL_RING and dies through
  `killActor(ctx, a, true)`: no score, Fang, drop roll, Vengeful or build procs; a shot Bomber always fizzles), `charger`
  (locked lane, breaks pieces before each step, stunned by walls / its room's box, one `HIT_HEAVY` per player per
  charge), `reaper` (spin: entries k / k + 8 of the WEB 16 @ FULL_RING row every 8 ticks), `stormcaller` (a row of
  three `BulletKind.STRIKE` = 12 bullets: speed 0, a 6-pass hold in the payload's `pierce` field so the Hourglass never
  stretches it, no grazes, never erased by guard / swings / Nova / Phantom Step, one player at most, `events.strikes`),
  `warbanner` (aura 125 % walk / 80 % cooldowns within 4.5 through `actorMods`, from a transient `SimCtx` mask rebuilt
  at the start of every `stepActors`: never hashed, a pure function of hashed state). `slamBreakables` takes an optional
  radius. Endless rooms buy them from floor 2 (weights 2 / 1 / 1 / 1 / 1, caps 4 / 2 / 2 / 1 / 2, `needsCompany` on the
  Warbanner) and the Ooze gained `OOZES_PER_ROOM` 8; `rosterOrder` shuffles 10 kinds (full roster on floor 19), so
  endless rosters, replays and scores changed from floor 1 (boards stay `_v1`; `DAILY.ruleset` 3, shared with solid decor). M1, every
  fixture and the tutorial replay exactly as before. Theme: five `ENEMY_ARCHETYPES`, colour role `enemyAura`, bullet
  visual `bullet.enemy.strike`, port audio IDs `sfx.enemy.fuse` / `.blast` / `.charge` / `.stun` / `.strike` /
  `.spin` (SILENT in the placeholder), optional enemy animations `death.2` / `move.back`, `bestiary.<id>` toasts. Vale:
  Imp 5, Demon Beast 1, Demon Spawn 7, Imp 3, Demon Spawn 5 sets built (`art:build`); all five sets
  and all six sounds uploaded and in `assetIds.ts` (the strike is the owner's Pixabay clip, DRAGON-STUDIO 386161);
  Studio check and tuning (NE12-NE13) pending.
- **Pellets (docs/PELLETS.md).** Gameplay. Floor-built: shared/dungeon `placePellets` lays each enemy room's pattern
  (ring / cross / lanes / zigzag, `PELLETS.patterns`) on reachable FLOOR cells off pieces and planned spawns, and a
  power pellet on about a third of the floors from floor 2, from its own stream (`floorSeed ^ PELLETS.salt`
  0x27220a95), stored as `EndlessFloorLayout` / `EndlessFloorWorld.pellets`; layouts, digests, props, spawns, pieces,
  loot, affixes and boss picks are unchanged. Opt-in `SimConfig.pellets` (`PELLETS_CONFIG`: every endless world, and the
  tutorial for its room G) creates `state.pellets` (`pelletsOnFloor` at createSimState and nextFloor; one `PelletRoom`
  per score record) with its own hash group `pellets` appended LAST (after `builds`); the sim draws no rng. A room's
  pellets go live when its record engages and go at its clear (`pelletRooms.ts`, from stepScore); `stepPellets`
  (between stepDrops and stepScore, so a pickup on the clear tick counts) gives each to the first living player within
  0.45 tiles. Score sources `PELLETS` (10, x the kills' floor scale) and `SWEEP` (11, flat: every regular pellet of the
  room taken before its clear) exist only with the flag (`addPelletScoreSources` pads JACKPOT); neither feeds the combo.
  The power pellet (not a Sweep pellet) erases every enemy bullet on the floor but goo and strikes and pays per bullet
  (cap `powerMaxBullets` 100). Tutorial: combat G (room 7; treasure / shrine / stairwell 8-10) with one sniper over a
  ring, `tutorialPellets` (no power pellet), the sweep lock `TutorialSimConfig.pelletLock` (five hashed fields appended
  to the `tutorial` group; the guard lock's hold), floor-1 seed 7500 -> 7574, step `pellets` 12, funnel revision 3
  (`t1r3`, caps 88 / 264). Theme: `pellet.normal` / `pellet.power` (assets and colour roles, placeholder `Block`,
  `pelletReport`: yellow `#ffff00`, >= 40 CIE76 from danger / build / player-outline roles, >= 30 from boosts), strings `score.source.pellets` / `.sweep`, `room.clear.line.pellets` / `.sweep`,
  `bestiary.pellet.power`, `tutorial.prompt.pellets*`, port audio IDs `sfx.pellet.eat` / `.sweep` / `.power` (SILENT in
  the placeholder; vale: the owner's Pixabay clips (Barnaby 155392, Stereogenic Studio 357164, EdR 484722) in
  gitignored `art/vendor/pixabay/`, uploaded 2026-11-03; SFX_FALLBACK keeps a silent pack on the tick / tier / parry); `contract.luau` / `validate.luau` at 186 / 196 top-level locals. View: `PelletRenderController`, pops,
  the power fly-in, tally segments `pellets` / `sweep` (a fold on the smallest phone), `KV_PelletDebug`. M1, every
  fixture and every replay without the flag replay exactly as before; endless and tutorial replays and scores changed
  (boards stay `_v1`, `DAILY.ruleset` 3 -> 5 with main merged). The chomp `sfx.pellet.eat` climbs the major scale over
  a room's pellets (`pelletEatSpeed`). Studio check, playtests (PL9 / PL15) and
  four owner calls pending (vale pellet art uploaded 2026-11-03).
- **Run-over recap and co-op moments (docs/RUN_RECAP.md).** Presentation plus telemetry only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change; boards and records untouched). `RunView.recapTally` (shared/view/fx
  `RecapTally`, on LiveRun and LockstepClient, collected every tick: parries per player by the director's grouping,
  grazes per player). Recap core in shared/view/hud `recap.ts` / `recapConfig.ts` (`RECAP` / `RECAP_HIGHLIGHTS` /
  `RECAP_STRINGS`, `nearMissFor`: one line, boss > score > record floor > stairs by walking path (`stairsPathTiles`,
  rooms never gate the stairs, RRD10) > full clear > next boss; `pickHighlights`: max 4, filled to 2, Team / You;
  `RecapTimeline`; `bossNoHitAwards` = `counts[BOSS] - (depth - startDepth)`) and `recapUi.ts` (`RECAP_UI`), shared/view
  audio `recapCue` (one `sfx.score.tick` / `.land` a frame), shared/play `RunOverRetryGate`. `RecapController`
  (`FX_FRAME_PHASE.normal`, after new best's `scoreRoll` step) builds the input once at run over, steps the timeline on
  real time, writes the store's `recap` slice and `RECAP_BINDINGS`, re-derives silently on a verdict. Again is focused
  and armed at 0.6 s through `RunOverRetryGate` (Again / Enter / Space / FIRE skip before, retry after; the `restart`
  key at once; party runs only skip, Back to lobby unchanged); Details hides the breakdown + Build list behind the
  highlights (RRD5). Strings `RECAP_STRING_KEYS` / `TEAM_MOMENT_STRING_KEYS` (shared/theme runRecap.ts, inside
  `REQUIRED_STRING_KEYS`); port audio IDs `sfx.room.teamperfect` / `sfx.player.syncparry` (`PORT_AUDIO_EVENTS`, SILENT
  in the placeholder; fallbacks `sfx.room.perfect` / `sfx.player.parry` at +5 semitones). Part B: the sim's PERFECT in a
  party run is TEAM PERFECT (CMD1; stamp / chip text and streak, gold pulse rings on every living member, RCD12's chip
  kept) and two players' parry groups starting within 12 ticks are SYNC! (`NearMissDirector` frame output
  `out.parryGroups`; `TeamMomentsController` steps the ONE `TeamMoments`, clears in the new `FX_FRAME_PHASE.teamMoments`
  (-2), parries on the first `syncs()` of a near-miss frame; `SyncCalloutController` floor text + tether). Revives
  reserved only. contract.luau / validate.luau stay at 186 / 196 top-level locals (counted on out/). Telemetry: one new
  custom event `RunRecap` (37 of 100 names; seconds the panel was open by close `retry` / `exit` / `lobby`, near-miss
  kind, record x skipped; a party run's team totals as rows on the same event) from the client remote `runRecap`,
  re-read by shared/run `readRunRecapReport`, rate limited (`RUN_RECAP_RATE`) and taken once per run session the server
  issued (`RunRecapGate`) by TelemetryService; analytics only. Debug `KV_TeamMomentsDebug`, `KV_RetryTiming` (RR8's
  press -> control print). Vale clips uploaded 2026-11-03 (CM7: Success2 + Gold1, Bonus3); Studio check (RR10) and the retry measurement (RR8)
  pending.

- **Bookshelves (docs/BOOKSHELVES.md).** Gameplay (dungeon), same Forge option as solid decor (endless only). A new
  solid kind `bookcase` (1 x 1, the Dungeon Essential Kit's case at 125 kit units a tile) stands flush in runs of
  2-5 against far walls only (+X / +Z facings), with 2 non-walkable cells behind (`SOLID_DECOR.bookcase.backTiles`)
  and never in front of a Forge torch or banner (`placeSolidDecor`'s trailing `hangs`). A new combat / elite theme
  `library` (weights grim 0.12 / other 0.20; 2-3 runs, candle stands at their ends, maybe a statue; a room where no
  run fits is dressed as plain) and a run of 2-3 in half the `hall` rooms; census 6.0 cases a floor. Decor plan: kind
  `bookcase` (appended last to DECOR_KINDS, low, variant 1 / 2 by facing), drop reason `behindShelf` on a case's back
  cell. Endless layouts, spawns, replays and scores changed (boards stay `_v1`); `DAILY.ruleset` 5 -> 6. M1, every
  fixture and the tutorial replay exactly as before. Art rendered (BK5: render_kit.py `sunSide`, the +X case lit
  from the mirrored side; vale `kit-bookcase-x` / `-z`, `DECOR_BOX.bookcase` 23 / 24 / 4), uploaded 2026-11-03 (BK6);
  Studio check pending. **Reading area** (docs/BOOKSHELVES.md "Reading area", BKD11-BKD14): every library also gets
  a solid line of chair, table (2 x 1), chair on open floor within `SOLID_DECOR.reading.maxDist` (8) of its shelves
  (`readingArea`, no rng draw); the solid pillars under it and its 2-tile ring are cleared (FLOOR again, listed in the
  new `Dungeon.clearedPillars`; `Dungeon.props` unchanged, the decor plan draws nothing for them). Decor kinds `table`
  / `chair` appended after `bookcase`. Art from the Dungeon Assets Pack by zver.3d (free, credit requested;
  `scripts/art/kit/zver_to_glb.py`). `DAILY.ruleset` stays 6. The six `kit-table-*` / `kit-chair-*` PNGs uploaded
  2026-11-04; Studio check pending.

- **Treasure rooms (docs/TREASURE.md).** Gameplay. Floor-built: shared/dungeon `placeVault` (after pellets, its own
  stream `floorSeed ^ VAULT.salt` 0xb5297a4d, 0 / 1 / 4 draws: 40 / 50 / 55 % of floors by band from floor 2, elite
  rooms x2, Legendary 25 % + 1 per floor up to 40 % else Rare, UNTOUCHED / SWIFT 50 / 50) picks a combat / elite room
  with planned spawns and a cell against a real wall (far wall first, `doorFarTiles` 6), stored as `EndlessFloorLayout` /
  `EndlessFloorWorld.vault`; the chest is appended LAST to the floor's breakables as kind `chest`
  (`BREAKABLE_PIECE_KINDS`, `BreakableKind.CHEST` 2; `BREAKABLE_KINDS` and its theme mirror stay the two clutter kinds),
  unbreakable (`damageBreakable` returns before any bookkeeping; slams skip it, a Charger stuns on it), so layouts,
  digests, props, spawns, loot, affixes, pellets and boss picks are unchanged and only `roomSpawnTiles` loses its cell.
  Opt-in `SimConfig.treasure` (`ENDLESS_TREASURE_CONFIG`: every endless world, solo / co-op / daily / dev) creates
  `state.treasure` with its own hash group `treasure` appended LAST (after `pellets`) and its OWN rng word
  (`seedToState(seed) ^ TREASURE.salt` 0x4b565452, "KVTR"), so no sim or drop stream draw moves on a floor without an
  open; `stepTreasure` (after stepScore) arms on the room record's engagement, cracks once (one tier down, never below
  Common) on party hits past present players - 1 (UNTOUCHED, TRD7) or at the end of the SWIFT countdown
  (`swiftParPercent` 100: exactly FAST), unlocks on the clear and opens on reach (TRD12) for every living present
  player: a relic (Rare), a bonus deal on the next floor's draft plus a boost (Legendary; `takeTreasureBonusDeals` in
  stepRun step 1), or two boosts (Common); boosts land in front of the chest and what the 4 ground slots cannot hold
  goes straight to its player (owner answer C1). `ScoreSource.TREASURE` (12, only with the flag, combo-neutral: depth x
  curse). Respite's levers are dormant until Respite exists (TRD10). M1, every fixture and the tutorial (its own layouts,
  no config) replay exactly as before; endless replays and scores changed (the charger / stormcaller run-4 determinism
  pins re-recorded, again on the merge with bookcases; the second merge, reading area, composed), the all-time boards stay `_v1` (TRD13), `DAILY.ruleset` 6 -> 7
  (main's bookcases took 6; this branch's 5 -> 6 never shipped; still 7 after main's reading area, which kept 6). Theme: slot `TREASURE`
  (`treasure.chest` / `.chestopen` / `.cage`, required; optional `fx.treasure.column`), floor-only colour roles
  `treasure.common` / `.rare` / `.legendary` (owner answer C2: the draft's `boon.rare` / `.legendary` measured 36.8 /
  34.2 CIE76 from `telegraph`; UI keeps `boon.*`) and `treasure.chest` / `.cage` (`treasureReport`), 16 strings
  `TREASURE_STRING_KEYS` plus `score.source.treasure`, port audio IDs `sfx.treasure.crack` / `.unlock` / `.open` and
  `sfx.jingle.treasure` (SILENT in both packs; fallbacks combo break / stairwell open / relic take / PERFECT jingle);
  `contract.luau` / `validate.luau` at 185 / 196 top-level locals (counted on out/). View, presentation only:
  `shared/view/treasure` (pure timelines, look, texts, toasts, minimap mark, sound edges), `TreasureRenderController`
  (chest, cage, tier sparkle, lock plate, crack / unlock / open, reward cards, solo 40 ms freeze, `stamp` nudge),
  `TreasureToastController` (floor toast once the stage cover is gone, arm toast per lock), the minimap's vault mark
  (tier floor colour, hollow once opened), the cue mapper on the look's edges (sting +0 / +3 / +7 semitones by tier, the
  Legendary jingle ranked 73: under `sfx.best.new`, over the room clear's). Debug `KV_TreasureDebug` (dev world vault
  override: `every`, tier, lock) and `KV_TreasureLabel`. Open for TR11: SWIFT at 100 % par was kept 30 / 30 in the TR5
  census (the bot clears vault rooms at ~28 % of par; target 40-60 %), and since the merge with bookcases (new room
  layouts) UNTOUCHED only 2 / 28 (was 8 / 25). A chest never stands on, against or beside a bookcase (the cell filter's
  solid-decor rules). Vale chest art rendered from the owner's "Old Chest" model (SebastianSosnowski, CC-BY 4.0, Credits screen;
  `kit-chest` / `kit-chest-open`, four facings, render_kit.py `importScale` / `lid`, per-facing sprite pivots), uploaded
  2026-11-04. Cage and light column (TR9, 2026-11-06, presentation only): original pixel art from
  `scripts/art/gen-treasure-art.js` (a domed iron birdcage in the chest's projection, four facings with the bars the chest
  hides cut; a looping greyscale column), each in a sheet of its own (`vault-cage.png`, `treasure-column.png`) from a new
  atlas group `treasure` (`--only treasure`, generated `packs/vale/treasureLayout.ts`), so no shared atlas repacks; the
  column is vale's third fx source; art cages turn with the chest, cap at `cageMaxHeightTiles` 1.2 and draw
  `cageDepthStuds` nearer the camera. Upload of both sheets, sounds (TR9), Studio check and playtest (TR11) pending.

- **Fortune (docs/FORTUNE.md).** Gameplay. Two opt-in configs, endless only: `SimConfig.pacts` (`ENDLESS_PACTS_CONFIG`)
  and `SimConfig.golden` (`ENDLESS_GOLDEN_CONFIG`), each with its own hash group appended LAST (`pellets`, `treasure`,
  `pacts`, `golden`: main's treasure rooms landed first) and a gated score source (`HORDE` 13, pacts only; `GOLDEN` 14,
  golden only, padding TREASURE / HORDE: an endless run's points / counts hold 15 entries, 13 with treasure alone, 14
  with pacts but no Goldling). Floor-built: shared/dungeon `placePactAltars` (the shrine room's two
  altars, Greed screen-left / the Horde screen-right of the crystal, mirrored, shifted 1-3 steps screen-up / down when
  blocked; no draw) and `pactCurseIndex` (Greed's shown curse per player, salt 0x5c3a91e7), then `placeGolden` (salt
  0x3d2f8b4d: 30 / 35 / 40 % of floors by band from floor 2, one combat / elite room of >= 100 FLOOR cells, with its
  rectangle and walk mask), both run last in `buildEndlessFloor` (after the vault; the altars read its chest as a
  piece): nothing else on the floor moves. Pacts: where altars
  stand the classic shrine (and the sim's `atShrine`) is off; step.ts calls `stepPacts` right after `stepRun` (not
  inside it: a require cycle) and `stepPactsWave` before `stepScore`. Greed = `acceptCurse` (+0.25) then a mid-floor
  one-deal draft (`drawLegendaryOffers`: unowned legendaries, available duos, level-II evolutions, filled with level-I
  upgrades; `openDealtDraft`, `draftKind` GREED for the title). Horde = the next room with planned spawns anyone enters
  fights a second wave (planned kinds, no affixes, <= 10, telegraphed 60 ticks at half down, appended to the
  record with its cost + the telegraph on the par; no clear before it) and pays x2 through `bonusPercent` (kills,
  ROOMS / PERFECT / FAST, pellets, Sweep; not power pellets or the Jackpot; the extra half to HORDE); needs scoring
  (else `NO_ROOM`); dim reasons `PactDim` with an extra `UNABLE`. `holdAbsoluteTimers` (`sim/pacts/holdTimers.ts`,
  pacts runs only) moves the live absolute-tick timers 1 tick per frozen draft tick (engaged records' `engageTick`,
  `waveDueTick`, the Goldling's appear / engage / field ticks, a live vault lock's `armTick` / `crackTick`, a Vengeful
  `vengeArmTick`), so a teammate's Greed draft
  eats no FAST par, telegraph or Goldling delay. The Goldling: archetype `golden` (band `PORT_BAND_FORTUNE` 5, index 18;
  `GOLDEN_HP` 24, 5.1 u/s, harmless, not a room member, drop-ineligible), own sim stream (`seedToState(seed) ^
  0x7a3c5e91`, a jink's side and the catch's boost kinds only); `stepGolden` after `stepScore`: appears 3 s after its
  room engages on the spawn tile farthest from the players, escapes 10 s later (status SKIPPED on a full pool); flees on
  the allocation-free `fleeField` (factor 1.2), standing still with no player in its room; coins 50 x floor scale per
  hit (no combo), the catch 1500 x floor scale into GOLDEN plus party size + 1 boosts. M1, every fixture and the
  tutorial replay exactly as before; endless replays and scores changed (boards stay `_v1`; `DAILY.ruleset` 7 -> 8 on the merge with main's treasure
  rooms, the branch's own 5 -> 6 never shipped). With treasure rooms (merge, 2026-11-04): a horde vault room holds
  SWIFT's crack while wave 2 is pending and adds the wave's par (`vaultParGrown`), so SWIFT stays exactly FAST; the
  chest is an intact piece for the Goldling's flee field and mask; Greed's deal never takes a chest's bonus deal.
  Theme: `pact.altar` (a new required `pact.` world-art slot, inline in `SLOTS`), optional `fx.golden.coin`, roles
  `roomEdge.horde` / `pact.horde` / `pact.greed` / `golden.coin` (`fortuneReport`, folded into `variantColorProblems`),
  `enemy.golden` `#c08000` -> `#f5c400`, strings `pact.*` and the Horde / Goldling lines, 8 port audio IDs (SILENT in
  the placeholder, `SFX_FALLBACK` entries; no `amb.golden.loop`); `contract.luau` / `validate.luau` 185 / 196 with treasure rooms merged
  (counted on out/).
  View: `shared/view/pacts` / `shared/view/golden`, `PactRenderController` (cards, flames, Horde rings and shouts),
  `HordeChip`, the 0.5 s Greed deal gap, the tally's `horde` segment, `ScorePopTone.HORDE`, `GoldenRenderController`
  (a 24-piece timer ring, coins, catch freeze), a minimap diamond, touch auto-target after any actor within 3 tiles;
  floor shouts goldenAppear 4 > newBest 3 > horde 2 > rank / goldenEscaped 1 > combo 0. Debug `KV_PactLabel` /
  `KV_GoldenLabel`. Art and audio (FO10), telemetry (FO11), playtest (FO13), the Studio check and seven owner calls
  pending. FO10's Goldling art is built (2026-11-04, presentation only): the atlas pipeline's per-set `recolor` (a
  gradient map by luminance, alpha kept, before crop / pivot / rim; docs/ART.md "Recolour") makes `enemy.golden` the
  swarmer's skeleton in gold (bodyTiles 0.95), `golden-move` / `golden-death` + rims; every older output byte-identical;
  uploaded 2026-11-04 (ids in `assetIds.ts`).

- **Projectile art (docs/PROJECTILE_ART.md).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or
  score change). Every flying bullet can draw a sprite from J i m's 16Bit Bullets pack (free `Player Bullets.rar`;
  terms only the author's page comment "use them however you want, even for commercial use", credited anyway; raw
  files in gitignored `art/vendor/player-bullets/`). One atlas `bullets.png` (`art/atlases.json` group `bullets`;
  `node scripts/art/build-atlases.js --only bullets` and `--lock --only bullets` need only that folder) and generated
  `packs/vale/bulletLayout.ts` (`VALE_BULLET_LAYOUTS`, `VALE_BULLET_FX_LAYOUTS`). Player: yellow / green bolts and the
  Hyper flame (heavy and shard gold-lifted by `recolor` to clear `telegraph` by 40 CIE76). Enemy: chevron / teardrops
  / needle recoloured into the danger pink (one ramp per set, means <= 12 CIE76 from `enemyBullet`, >= 3:1 on every
  floor and wall; the build gates both). Theme: BULLET takes `sprites` (`heading: "up"`, `BULLET_ART`,
  `MAX_ENEMY_BULLET_ART_DIFFERENCE`), `ThemePack.bullet(id)`, validator `bulletArtReport` (goo / strike / ember are
  decal ids and take no art), optional fx id `fx.bullet.hit` (the impact burst, packed in `bullets.png`; vale fx now
  read a list of sheets, `VALE_FX_SOURCES`). View: `shared/view/bullets` (`enemyBulletLookOf` sniper needle / caster
  medium / boss large / else small, `bulletFrame`, `bulletYaw`, `BulletImpacts`); `SpriteBulletPool` (anchor Part +
  Top-face SurfaceGui per slot, one BulkMoveTo, provisional until spike PA0); the neon pools skip what it draws; every
  enemy look keeps the small ball as its placeholder; `FxCueMapper.bulletHit` (lowest rank, 3 a frame, half the
  budget); `bullet.` in `PRELOAD.core`. Spike PA0 in spike A (`KV_SpikeBullets`, modes N / A / B / C on keys 5-8).
  `bullets.png` uploaded 2026-11-05 (PA8, `assetIds.ts`), so the bundled vale pack draws the art. Spike PA0, the
  Studio check (PA9) and a full laptop `art:build` pending.

- **Goo art (docs/GOO_ART.md).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change).
  The Ooze's goo puddles can draw the last two frames of the Free Slimes Asset Pack's green slime death (heimlich3;
  commercial use, modification allowed, no redistribution or AI training; raw files in gitignored
  `art/vendor/Free Slimes Asset Pack/`, Credits screen): frame 3 for the first `landSec` 0.1 s, frame 4 for the rest, the
  same fade as the disc, a mirror from the slot index. Recoloured into `enemyGoo` (mean 7.1 CIE76). Its own sheet
  `goo.png` (`--only goo`, generated `packs/vale/gooLayout.ts`). Supersedes PAD3 for goo only: `BULLET_ART.floorSpriteIds`
  (strike / ember keep `decalIds`, no art), per-id animations `land` / `hold` (`SlotContract.idBaseAnimations`), a
  `lit` box on the set, `gooArtReport` (own module; contract.luau / validate.luau stay 186 / 196). Flat on the floor,
  depth stretched by 1 / sin(pitch), sized so it covers the hit on screen (`gooSpriteSize`: 1.05 x 0.70 tiles);
  `FloorSpritePool` behind the goo `DecalPool`. Without a `goo.png` id the disc is drawn as before; uploaded 2026-11-06
  (`assetIds.ts`), so the bundled vale pack draws them. Studio check (GA7, after PA0) pending.

## Commands

```
npm run verify      # typecheck -> lint -> build -> headless tests. Run before you finish
npm test            # gen fixtures -> rbxtsc -> Lune runs every out/shared/**/*.spec
npm run test:only -- sim/rng   # rerun specs without rebuilding; args filter by source path
npm run build       # gen fixtures -> rbxtsc -> out/
npm run dev         # rbxtsc -w + rojo serve
npm run build:place # publishable place: build/kaleb-vale.rbxl from publish.project.json (no specs, fixtures or Jest)
npm run test:plugin # Studio test-runner plugin (same specs under real @rbxts/jest in Studio)
npm run art:build   # art/vendor -> art/build atlases + packs/vale/layout.ts / fxLayout.ts (art:lock rewrites art/vendor.lock.json)
npm run test:art    # node:test specs of the atlas pipeline (scripts/art/*.test.js; part of verify)
npm run audio:build # art/vendor/ninja-adventure/Audio -> art/build/audio/*.ogg + packs/vale/audioLayout.ts (audio:lock, audio:audition)
npm run l10n:export # (after build) English + l10n/context.json -> l10n/out/kv-strings*.csv for the Roblox cloud table
npm run l10n:import -- l10n/in/table.csv   # the whole downloaded cloud table -> shared/theme/locales/*.ts + l10n/report.md
npm run l10n:check  # (after build) translation coverage / stale / context report (test:l10n, check:autolocalize: in verify)
```

Tools come from `rokit.toml` (`rokit install`): rojo 7.7.0, lune 0.11.0.

## Tests

- Specs are `*.spec.ts` next to the code, written against `@rbxts/jest-globals`
  (`import { describe, expect, it } from "@rbxts/jest-globals"`). The same file runs headlessly and in Studio.
- `npm test` runs them **headlessly under Lune** (`scripts/lune/run-tests.luau`) with Jest's real JestCircus,
  Expect and JestMock modules. Only specs under `src/shared/**` are discovered (client/server code needs the engine).
- Not available headlessly: snapshots, fake timers, `jest.mock`, real Instances or services. Roblox datatypes
  (Vector3, CFrame, Color3, Enum, ...) exist outside the sim (Lune's float32 implementations).
- Fixtures: `fixtures/**/*.json` become `src/shared/fixtures-generated/<name>` (gitignored, regenerated before
  build / typecheck / lint). Import with a default import: `import rng from "shared/fixtures-generated/rng"`.
  Numbers are bit-exact (written as shortest round-trip literals, `-0` kept); a `.` in a file name becomes `_`.
  Never route fixtures through Rojo JSON modules or `HttpService:JSONDecode`: serde-style parsers can be 1 ULP off.

## The sim is deterministic and Roblox-API-free

`src/shared/sim/**` (and `src/shared/dungeon/**`, which the sim calls) is plain TypeScript: no Roblox services,
Instances, datatypes, Enums, Flamework decorators, `os.clock` / `tick` / `time` / `os.time`, or `math.random`.
Everything `step()` reaches must replay bit-identically (the source's `src/sim/README.md` rules apply: no trig in
the sim, fixed iteration order, every state field hashed). The headless runner **enforces** this: those modules
load in a restricted environment where the forbidden globals throw `[determinism] ...`. Spec files are exempt.

Port JS-isms deliberately: `.length` -> `.size()`, `null` -> `undefined`, 32-bit integer math through `bit32` and a
split-16-bit `imul`, no getters in sim state.

## Conventions

- **Janitor** for cleanup, never Maid.
- **Barrel `index.ts`** per directory. Import from the directory, not the file (generated fixtures are the exception).
- **`client/` and `server/` never import each other.** Shared contracts live in `shared/`.
- **No magic numbers.** Tunables live in `shared/config` (or the data module that owns them), never inline in logic.
- **Roblox properties are float32; Luau arithmetic is float64.** A value written to a property and read back is not
  the value you computed. Assert with tolerance (`toBeCloseTo`) only where a value passes through a property or
  accumulates; keep exact assertions where it never leaves float64 (all sim and fixture parity checks).
- Every visual and audio asset goes through logical IDs in `shared/theme`; no `rbxassetid://` anywhere else.
- Luau reserves some identifiers roblox-ts rejects (`next`, `not`, `end`, `table`, `type`, `local`, `_`); rename them.
- **`for (let i = 0; i < arr.size(); i++)` reads the bound once** (it compiles to a numeric Luau `for`). If the body
  grows or shrinks the array (queues, swap-remove, free stacks), use a `while` loop.
- roblox-ts drops arithmetic on the left of a for-loop condition: `for (let t = 0; t + 110 <= n; t++)` compiles to
  `for t = 0, n`. Keep the loop variable alone on the left (`const last = n - 110; t <= last`).
- Hooks on def objects (`ArchetypeDef`, `WeaponDef`) are called with `:`; write every hook as a method
  (`onHit(ctx, a) { engageOnHit(ctx, a); }`), never `onHit: engageOnHit`.
- A new bullet burst shape needs an entry in `combat/arcTable.ts` (regenerate with `scripts/gen-arc-table.js`);
  until then it fails with "arc table miss". A shape only the port's own archetypes fire (no web source) is a row in
  `combat/arcTablePort.ts` instead (never edit the web fixture).
- `throw` compiles to `error(x)`, which prefixes `file:line:`; use `error(msg, 0)` where the message is compared.
- Interface methods compile to `:` calls: implement them with method syntax; type arrow-function properties as
  `f: (a) => T`. `**` compiles to `^` (pow): use plain multiplication on the sim path.
- No `splice`/`slice`: use `arr.remove(i)` and loops. Iterate fixture objects as a `ReadonlyMap` view
  (`pairs()` on a Record trips `roblox-ts/no-array-pairs`).
- `scripts/check-asset-ids.js` flags strings of 7+ digits; on a legitimate hex/digest test vector append
  `// check-asset-ids: allow (reason)`.

## Working agreement

- Report failures plainly, with output. If you skipped something, say what and why.
- Spikes and debug features are off by default (Workspace attributes / `shared/config`), cleaned up with Janitor.
