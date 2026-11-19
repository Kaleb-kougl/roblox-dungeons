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
| `docs/BOOST_ART.md` | Boost drop art (Lords of Pain gold coins and gemstones, tinted halo and beam, gems out of decor) and the boost auras (original pixel-art rings per kind and stack rank, BAD3): plan, tasks BA0-BA7, decisions |
| `docs/BREAKABLE_DROPS.md` | Boosts from breakables (some barrels / crates hold a boost, picked per floor from the floor seed, released on any break, a soft glint on loaded pieces): plan, tasks BL0-BL9, decisions BLD1-BLD9 |
| `docs/SNIPER_ART.md` | Sniper art (`enemy.sniper` as the Lords of Pain subservient): mapping, budget, tasks SN1-SN8, decisions D1-D6 |
| `docs/BOSS_DEMONLORD.md` | Demon Lord boss variant (`boss.demonlord`, seeded pick per endless boss floor, Lords of Pain Demonlord art): plan, tasks D0-D8, decisions |
| `docs/CURSOR.md` | Gauntlet mouse cursor in menus only (Lords of Pain `cursor_gauntlet_*`, software cursor in menus and run overlays, gameplay keeps the Roblox pointer, hover colour, Cursor size setting; revision 2): plan, tasks C0-C8, decisions D1-D5 |
| `docs/DEMON_ART.md` | Placeholder enemies as 2D Demons (bruiser = Demon Beast 3; turrets sprayer / caster = Demon Spawn 8 / 11; Lords of Pain art unchanged): plan, tasks DA0-DA15, decisions DD1-DD7 |
| `docs/BRAMBLE_ART.md` | Mother Mayhem (`boss.act1`) as a 2D Demons Elite: state-to-animation mapping, size and budget, tasks BR0-BR7, decisions BD1-BD7 |
| `docs/ROOM_EDGES.md` | Room edges (dashed floor line where every corridor meets a room, tinted safe / waiting / live): plan, tasks RE1-RE8, decisions RD1-RD9 |
| `docs/VOID_DECOR.md` | Void decoration (rock shoulder along every wall and corridor, ledges, a dark biome-tinted abyss, set pieces framing rooms from behind their far walls; presentation only): census, plan, tasks VD0-VD11, decisions VDD1-VDD9 |
| `docs/HUD_LAYOUT.md` | In-run HUD footprint (corner panels, full-width band fix, info line to the pause menu, occlusion fade): plan, tasks H1-H9, decisions HD1-HD8 |
| `docs/FEEL.md` | Game feel pass (hurt flash and jolt, hit flash / hold / push, squash & stretch, roll afterimages, low-health pulse, screen shake setting): plan, tasks J1-J12, decisions JD1-JD13 |
| `docs/MINIMAP.md` | Minimap with fog of war (corner map + full-map toggle, sight + whole-room reveal, shared party map): plan, tasks M0-M12, decisions MD1-MD14 |
| `docs/PRELOAD.md` | Asset preloading (join loading screen for the core tier, background queue for bosses / later music): plan, tasks P0-P7, decisions D1-D6 |
| `docs/STAGE_LOADER.md` | Stage loader (cover while a floor generates and loads: run start, stairwell card, pre-generation during the boon draft, deferred view rebuilds): plan, tasks SL0-SL8, decisions SD1-SD6 |
| `docs/STAGE_ASSETS.md` | Stage assets (a per-floor asset manifest from the layout, a `next` prefetch lane, a short join screen; revision 2: playable while loading on every device, the placeholders drawn as stand-ins until each id has downloaded and swapped live, a 1.5 s soft wait at run start and no holds, a stand-in box for solid decor, late cues dropped, `KV_StandInsForce` / `KV_FakeAssetLatency` / `KV_StageAssetAudit`): plan, tasks SA0-SA20, decisions SAD1-SAD16 |
| `docs/INVITES.md` | Roblox friend invites (`PromptGameInvite` + LaunchData into a lobby) and Roblox Party grouping: plan, tasks I0-I9, decisions ID1-ID7 |
| `docs/MOBILE.md` | Mobile play (two-stick touch controls with auto-target, touch HUD, touch menus / tutorial, real-device performance): plan, tasks MB0-MB16, decisions MBD1-MBD10. Step-by-step build: `docs/MOBILE_IMPL.md` (MB1-MB13) |
| `docs/ROOM_CLEAR.md` | Room clear celebration (1.5 s: 0.5x slow motion on the last kill, CLEAR / PERFECT stamp, room score tally rolling into the score panel, a corner chip for a far co-op clear, On / Off setting; presentation only): plan, tasks RC0-RC10, decisions RCD1-RCD18. Step-by-step build: `docs/ROOM_CLEAR_IMPL.md` (RC1-RC9) |
| `docs/COMBO.md` | Combo you chase (named tiers x2 Rampage / x3 Carnage / x4 Dominating / x5 Unstoppable, tier-coloured meter, kill sound climbing in pitch, tier-up sting and a floor shout that never hides bullets, a shatter on a break during a fight, a quiet lapse otherwise; presentation only): plan, tasks CB0-CB9, decisions CD1-CD16 |
| `docs/DRAFT_REVEAL.md` | Boon draft reveal (cards deal face down and flip one by one, a rare chime, a legendary beat: charge, hush, flare and halo; a pick stamp; skip by pressing; the client holds the confirm until settled; cards in the ToffeeCraft Horror UI sheet's style; presentation and client input only): plan, tasks DR0-DR9, decisions DRD1-DRD12 |
| `docs/ENEMY_VARIANTS.md` | Enemy variants (three new endless archetypes: Imp flanker, Ooze zone-denier that splits, Summoner support; elite affixes Hulking / Swift / Shielded / Vengeful; both unlock by depth): plan, tasks EV0-EV14, decisions EVD1-EVD12 |
| `docs/GRAZE_PARRY.md` | Grazes and parries (graze spark + shimmer climbing in pitch, parry sparks / ring-out / PARRY! floor flash / solo 30 ms freeze for a guard that erases bullets; one unhashed ScoreEvents feed, otherwise presentation only): plan, tasks GP0-GP10, decisions GPD1-GPD10 |
| `docs/UI_ART.md` | UI art (the dark red pixel UI sheet: 9-sliced panels / buttons, hearts, potions, pills, icons, focus brackets; menus, then the in-run HUD, then touch; presentation only): builds on the Draft reveal (`slice`, `SlicedImage`): plan, as built, the armor pips (original 9 x 9 shields), tasks UA0-UA15, decisions UAD1-UAD10 |
| `docs/NEW_BEST.md` | New-best celebration (points-to-best in the score panel's label row, a fanfare + NEW BEST stamp / floor shout / edge confetti when the shown score passes your best or you reach a floor past your deepest, a record fanfare and old -> new roll at run over; server-owned personal records doc `KV_Records_v1`; no sim change): plan, as built, tasks NB0-NB11, decisions NBD1-NBD11 |
| `docs/DEV_MODE.md` | Developer mode (jump to any floor, instant R restart, god mode; local `dev` world, server-allowed players only via `DEV_MODE`): usage, access, how it works |
| `docs/BUILDS.md` | Builds (on-kill boons Chain Spark / Volatile / Soul Shards with chain reactions, boon levels with an evolution at III, duo boons, the boss double draft; gameplay, opt-in `SimConfig.builds` on endless only): plan, tasks BU0-BU14, decisions BUD1-BUD14 |
| `docs/DAILY.md` | Daily dungeon and seeded rosters (every endless seed picks its enemy kinds: swarmers + 1 on floor 1, one more every 2 floors; a `daily` world with one server-side seed per UTC day, day-scoped solo / co-op boards, percentile, friends, rank climbing, yesterday's podium): plan, tasks DS0-DS14, decisions DSD1-DSD16 |
| `docs/LOCALIZATION.md` | Language localization (the 17 languages Roblox auto-translates; player's Roblox language by default, a Language override in Options; translations from the Roblox cloud table, imported into validated generated tables; AutoLocalize off on every GUI; fonts per script; pseudo-locale `en-XA`): plan, as built, tasks L0-L15, decisions LD1-LD14 |
| `docs/PORTRAIT.md` | Portrait play (phones turn either way, `Sensor`; upright the view keeps the short side at `VIEW_TILES_HIGH` with the player lifted above the thumbs, touch controls in a bottom band, pause map on top, the draft in a column, the HUD scale capped to the width): plan, tasks PT1-PT9, decisions PD1-PD7 |
| `docs/NEW_ENEMIES.md` | New enemies (five endless room archetypes from floor 2: Bomber rusher that blows up, Charger lane charge stunned by walls, Stormcaller lightning strike rows, Warbanner aura support, Reaper bullet spiral; band 4, `BulletKind.STRIKE`, the Warbanner aura in `actorMods`; gameplay): plan, NE0 findings, tasks NE0-NE14, decisions NED1-NED14 |
| `docs/NEW_ENEMIES_2.md` | New enemies 2 (four endless room archetypes and a child, band 6: Shieldwall (`bulwark`) front shield that covers allies behind it, broken by the finisher / heavy arrow / Siege slam; Chainhook `BulletKind.HOOK` that drags the player, never on floor 1; Snatcher harmless pellet thief that flees, swallowing loses the Sweep; Pyre-keeper lighting `pyre` braziers that fire flame bullets; no new hash group; gameplay): plan, NX0 findings, as built NX1-NX9 and NX11 / NX12-lite, tasks NX0-NX14, decisions NXD1-NXD24 |
| `docs/NEW_ENEMIES_3.md` | New enemies 3 (three endless room archetypes in band 7: Mortar lobs a `STRIKE` shell over cover at where you are heading, only while you are in its room, with a guardable shrapnel ring, landing even after its death; Mender channels a heal beam into the most wounded room enemy, cut by a hit, a body on the beam or a wall; Jackal packs of three bought as one (`packOf`) that circle and lunge at your back, spooked by your facing, a sword guard stopping a lunge as a parry; no new hash group or bullet kind; gameplay): plan, NT0 findings, as built NT1-NT10, NT11 systems pass, NT12 tuning (owner calls OC1-OC5), tasks NT0-NT14, decisions NTD1-NTD14 |
| `docs/PELLETS.md` | Pellets (Pac-Man lines of small cubes laid on a fight's floor, collected while enemies live, a Sweep bonus for every one, a rare power pellet that turns every enemy bullet on the floor into points; tutorial room G with a sweep lock; gameplay): plan, as built, open owner calls, tasks PL0-PL15, decisions PD1-PD16 |
| `docs/RUN_RECAP.md` | Run-over recap and co-op moments (one honest near-miss line, up to four counting highlights, Again in one press armed at 0.6 s and a faster retry; co-op TEAM PERFECT stamp / chip / streak / pulse rings and SYNC! parries; revives reserved; presentation only): plan, tasks RR0-RR11 / CM1-CM7, decisions RRD1-RRD11 / CMD1-CMD7 |
| `docs/RUN_CONTRIBUTION.md` | Co-op contribution on the run-over screen (a `You / Team / Party` tab strip in party runs, opening on You: your damage / kills / boss-damage share, parries, grazes, hits, pickups and standing; every player's row in index order with one positive title; the `You` rows fixed to the local player; one unhashed `ScoreEvents` feed, otherwise presentation only): plan, tasks CT0-CT10, decisions CTD1-CTD7 |
| `docs/BOOKSHELVES.md` | Bookshelves (Dungeon Essential Kit bookcases, solid 1 x 1 cases flush in runs on rooms' far walls; a new `library` room theme plus a run in some `hall` rooms; endless layouts change): plan, tasks BK0-BK10 / RA1-RA6, decisions BKD1-BKD14; the library's reading area, a table and two chairs |
| `docs/TREASURE.md` | Treasure rooms (vaults: about one endless floor in two from floor 2 has a caged chest in a combat / elite room, seen through the doorway; clearing the room unlocks it, its lock (UNTOUCHED / SWIFT) kept or cracked one tier down; walk up to open it: a relic, boosts or a bonus draft; gameplay, opt-in `SimConfig.treasure`): plan, TR0 findings, as built TR1-TR8, tasks TR0-TR11, decisions TRD1-TRD14 |
| `docs/FORTUNE.md` | Fortune (risk shrines: two pact altars in the shrine room, Greed = a shown curse + a Legendary deal now, Horde = the next room fights a second wave for x2 score; the Goldling: a rare harmless gold enemy that flees within its room, coins per hit, a jackpot if caught within 10 s; gameplay, opt-in `SimConfig.pacts` / `SimConfig.golden` on endless only): plan, as built, open owner calls, Studio check, tasks FO0-FO13 / PS1-PS5 / GE1-GE4, decisions FD1-FD16 |
| `docs/GOLDLING_RUMOURS.md` | Goldling hiding places and rumours (the Goldling brings its own barrel or crate into its room, glinting like a loot piece, and comes out when a player breaks it; only players can break it; a floor rumour (coin jingle + `Coins jingling...` chip) and a room rumour (`It's hiding here!`), a first-time card; gameplay for the Goldling, opt-in `SimConfig.golden`): plan, as built, the hunt census, Studio check seeds, tasks GR0-GR12, decisions RD1-RD15 |
| `docs/PROJECTILE_ART.md` | Projectile art (every flying bullet drawn with the Player Bullets pack: yellow / green bolts and the Hyper flame for the player, chevron / needle / teardrop recoloured into the danger pink for enemies, optional `fx.bullet.hit`; goo / strike / ember unchanged; presentation only): plan, measured pack, mapping, tasks PA0-PA10, decisions PAD1-PAD11 |
| `docs/DUMMY_ART.md` | Training dummy art (`enemy.dummy` drawn with the Training Dummy 2D Pixel Art pack: one facing, idle / 7-frame hit wobble / 9-frame break, the wobble on a view-side 0.7 s hit clip; presentation only): plan, tasks DA1-DA7, decisions DD1-DD5 |
| `docs/GOO_ART.md` | Goo art (the Ooze's goo puddles drawn with the heimlich3 Slime pack's last two frames: land then splat, recoloured into `enemyGoo`, flat on the floor sized to cover the hit; presentation only): plan, tasks GA0-GA7, decisions GAD1-GAD5 |
| `docs/KENNEY_DECOR.md` | Kenney decor (Kenney's CC0 Isometric Dungeon / Library reprojected from their 30 degree camera to the game's 55 by `scripts/art/kenney/reproject.py`: flat / box / uniform warps; library v2, a `mess` theme, richer storerooms built as Forge pieces (KN5-KN9); the bookcase's alternative art set, its wide pairs and the floor patches wired): plan, as built, tasks KN0-KN13, decisions KND1-KND12 |
| `docs/LEGENDARIES.md` | Legendaries (two legendary boons, Overkill: a kill's leftover damage streaks to the nearest enemy and chains; Bastion: a full-ring 27-tick guard, +1 pip and a brace that restores a pip when a guard or roll stops 8 bullets; four duos Supernova / Skewer / Citadel / Stone Heart; gameplay, opt-in `SimConfig.builds`): plan, LG0 findings, as built LG1-LG6, LG7 tuning, owner tuning, tasks LG0-LG9, decisions LGD1-LGD14 |
| `docs/HAZARD_ART.md` | Hazard art (the Stormcaller's strike and the build embers as original greyscale pixel art tinted by their roles: a flash over the strike's 0.1 s life and a short scorch after it, the ember's burn loop; supersedes PAD3; presentation only): plan, as built, tasks HA0-HA8, decisions HAD1-HAD5 |
| `docs/GAMEPAD_MENUS.md` | Gamepad menus (every menu usable with a controller: focus scopes with one owner, recovery and memory, one B path (hold B to exit on run over), LB/RB / LT/RT tabs, right-stick scroll, X / Y shortcuts, a hint bar with Roblox button icons, menu haptics, console TV-safe fit; client input and presentation only): census, plan, as built, tasks GM0-GM12, decisions GMD1-GMD16 |
| `docs/WALL_SLIDE.md` | Wall slide (the player's body slides round corners instead of stopping: `slideCircle` collide and slide, a corner tie-break, a face assist within 0.35 tiles of a wall's end, a full pillar slip on isolated 1 x 1 blockers; every world, M1 included; snag census; gameplay): findings, plan, as built, tasks WS0-WS10, decisions WSD1-WSD7 |
| `docs/FRAME_PACING.md` | Co-op frame pacing (a playout clock: received merged frames stepped at a steady 60 Hz from a small jitter buffer, holds on underflow, the input lead covers the buffer; the lead-never-decays fix; client timing only; revision 2: the net lead from measured input trips, a per-member input echo on `lockstepFrames`; revision 3: no late bump, a p99 / 15 s cover capped at the prediction cap, long-spike episodes kept out of it, the lead census): findings, plan, census, tasks FP0-FP23, decisions FPD1-FPD20 |
| `docs/ROLLBACK_SPIKE.md` | Rollback measurement spike, closed (the record: CPU of copying the state and stepping it H ticks a frame on a Mac and an iPhone, mispredictions in a bot sweep): census R0, design, as built, tasks R0-R7, results, decisions RBD1-RBD8 (RBD8: don't build rollback; the code removed in R7) |
| `docs/LOCAL_PREDICTION.md` | Local prediction in co-op (your own knight's body drawn up to 20 ticks past the merged state from the inputs you sent, corrected by a smoother; enemy bullets drawn as far ahead; vitals, hits and everything else merged; presentation and client timing only): findings, census LP0, design, as built, LP8 sign-off, tasks LP0-LP10, decisions LPD1-LPD9 |
| `docs/BUILDS_V2.md` | Builds v2, wave 1 (Riposte: a guard that erases bullets answers with a counter-wave, Counterstrike ring and returns; Ballista: the heavy arrow bursts into bolts, Siege Bolt pins and drags an enemy into a wall; Wrecker: rolls smash breakables, every piece you break fires splinters, Demolition chains them; duos Thunder Guard / Stillwater / Rebuke (Bastion + Riposte) / Dragon Bolt / Powder Keg / Full Heart / Happy Hour; the duo hint on New cards; overcap boss points `ScoreSource.OVERCAP`; gameplay, opt-in `SimConfig.builds`; wave 2 and the proposal in its appendix): plan, tasks BV0-BV13, decisions BVD1-BVD20 |
| `docs/ARCHER.md` | The Archer (the bow split off the knight into its own character: Knight = sword, Archer = bow and a longer roll, one weapon set each; weapon-tagged boons / relics dealt only to the character who carries the weapon; a character screen every run; Knight-only tutorial without the bow room; shared boards with the character shown; SmallScaleInt Archer art): plan, tasks AR0-AR14, decisions ARD1-ARD17 |
| `docs/FLOOR_MODIFIERS.md` | Floor modifiers (about one endless non-boss floor in five from floor 2 is special and the floor card says so: Gilded = a certain Goldling, Hoard = a certain vault, Feast = a certain power pellet, Plunder = a boost in every room's barrels, Blood Moon = twice the elites; only where true, never on boss floors, never two in a row; a banner on the card, a status chip and a pause line; gameplay, floor-built, opt-in `EndlessFloorOptions.modifiers`, endless only): plan, as built, FM9 census, open owner calls OC1-OC3, Studio check, tasks FM0-FM13, decisions FMD1-FMD12 |
| `docs/CODEX.md` | Codex (a main-menu catalogue of 86 entries (87 with docs/SECRET_ROOMS.md's `secret:room`): boons, evolutions, duos, relics & curses, boosts, enemies, champions, bosses; each unknown / seen / found with a NEW dot, completion %; in-run NEW! chips on existing toasts, codex cards on the sighting slot under a 2-per-floor budget, NEW tags on unfound draft cards, a run-over row; client-claimed, server-stored `KV_Codex_v1`; presentation plus one server doc): plan, as built, tasks CX0-CX11, decisions CXD1-CXD15 / R1-R14 |
| `docs/HAPTICS.md` | Haptics in play (a kill tick, a parry thump, the boss phase break's heavy hit, the boss death rumble and three hurt buzzes, on the view player's own events only, by priority with a kill gap / cap and a 40 % duty cap; pads through `SetMotor`, phones through `HapticEffect`; quiet in menus, spectating and after run over; `padVibration` for menus and play, a new `touchVibration` on Options > Controls > Touch; `KV_HapticDebug`; presentation only): plan, as built, tasks HP0-HP8, decisions HPD1-HPD12 |
| `docs/SECRET_ROOMS.md` | Secret rooms (a cracked far wall that knocks hollow hides a small torch-lit chamber with a chest; about one endless floor in five from floor 2, nothing announces it; opened by the Knight's combo finisher, a heavy arrow / Siege slam, a Wrecker roll or a Charger's charge; the chest Rare 65 / Legendary 35 with the vault's grants; SECRET! shout, recap highlight, one Codex entry; gameplay, opt-in `SimConfig.secrets`, endless only): plan, as built (Tracks A / T / V1 / V2), Studio check, tasks SR0-SR16, decisions SRD1-SRD14 |
| `docs/SILVER.md` | Silver, the cross-run currency (phase 1 built): earned per room cleared, per floor / boss / vault / secret / Goldling, from Silver in barrels and crates (floor-built, any break pays), a run minimum and day bonuses; server-owned wallet `KV_Wallet_v1` (transactions only); spent in the Armory on upgrades (Vigor / Deep Flask / Plating / Prospector) and the Archer unlock on one doubling price ladder; base hearts down by one (Knight 2, Archer 1 1/2) with half-heart containers: SV0 findings, plan, as built, tasks SV0-SV18 / SC1-SC4, decisions SVD1-SVD41 |
| `docs/SILVER_SHOP.md` | Silver shop (Silver for Robux through developer products: four packs Pouch / Purse / Chest / Hoard, 150-2,500 Silver at 20 / 55 / 115 / 265 Robux by default, prices read from Roblox; one pool with earned Silver; a quiet `+` beside the Armory's and the main menu's balance only; each receipt one wallet transaction with a `PurchaseId` ring; `KV_FakeShop` in Studio; supersedes SVD1): plan, as built, tasks SH0-SH9, decisions SHD1-SHD11 |
| `docs/COSMETICS.md` | Cosmetics from recoloured sprites (dye sheets cut from the existing Knight / Archer body sheets and tinted at runtime: 8 dyes + Prismatic per character; outline, roll-trail and spark colours; the Armory's Cosmetics tab with try-on; looks sent to teammates; readability validator `cosmeticReport`; presentation, wallet catalogue and server fields only): plan, as built, tasks CS0-CS12, decisions CSD1-CSD12 |

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
- **Half-hp bosses (port retune, 2026-11-06).** Every boss's base hp is `BOSS_HP` = 270, `BOSS_HP_PERCENT` 50 % of the
  web build's `WEB_BOSS_HP` 540 (`archetypes/boss/shared.ts`; Mother Bramble and the Demon Lord; endless Depth and
  party scaling start from it), so a fight's flawless floor at the 6/s damage cap is 45 s (was 90 s). The tutorial's
  practice boss (`TUTORIAL.bossHpPercent` 20) halves with it, 108 -> 54 hp. A sim change: M1, endless and tutorial boss
  fights play and score differently from older builds. Every golden fixture and the web-tuned specs
  replay under `setBossHp(WEB_BOSS_HP)` (`boss/hp.ts`) next to `setSwarmerHp(WEB_SWARMER_HP)` and still match bit for
  bit; the Demon Lord's own specs scale their bands by `BOSS_HP / WEB_BOSS_HP` (TTK 1..2 minutes, measured 61-100 s).
- **Stronger, aim-assisted charged arrow (port retune, 2026-11-06).** The bow's heavy arrow hits for
  `BOW_HEAVY_DAMAGE` = 5, the web build's 4 + 1, and is aim-assisted: on release it flies straight at the living enemy
  whose bearing is nearest the facing within `BOW_DATA.heavyAssistConeCos` (cos 10 degrees, a literal), the arrow's
  reach (`heavySpeed` x `heavyLife`) and line of sight (`bowAssistAim`, sqrt only; no target: the facing as before). The
  stream is unchanged. Fully charged, the aim line (WeaponViewController) points where the arrow will fly. A sim change:
  every run with a heavy arrow (M1, endless, the tutorial's bow lesson, 5.5 -> 5.3 s in the pinned funnel rows) plays
  differently from older builds. The bow parity specs (`constants`, `runBullets`) replay under
  `setBowTuning(WEB_BOW_TUNING)` (heavy damage 4, no assist) and still match bit for bit.
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
  changed. Mother Mayhem's slam rule is nearly dormant: boss rooms get no pieces, so it only reaches one in a room
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
  and breakables are unchanged. Score tables give him Mother Mayhem's 5000 points and final phase 3. M1
  (`KALEB_VALE_MVP_PARAMS`), every fixture and the tutorial keep Mother Mayhem and replay exactly as before; endless
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
  `hud.items.more` and `options.display.hudFade`. The fade also covers the top-centre toasts and the first-sighting card (fade slots
  `HUD_FADE_SLOTS`, `Panel` `fade`; HD9); first sightings show on that card at the left edge under the status panel,
  held out of `HUD_CLEAR_ZONE` (docs/ENEMY_VARIANTS.md EV12).
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
  `KV_DailyRankDebug`, Studio `KV_FakeFriends`. DS0 spike and Studio check pending. **DSD17 (2026-11-11):** the Daily's
  roster ignores the unlock floors (`DAILY.rosterUnlockFloors` false, shared/run `rosterUnlockFloors(world)`,
  `endlessRoster(seed, floor, unlockFloors)` / the spender's `unlockFloors`): the day's seed alone orders the pool, floor
  1's seeded kind any of the ten; daily replays changed, `DAILY.ruleset` 14 -> 15; endless / dev keep DSD9.
  **DSD18 (2026-11-11):** endless and dev follow the same rule (shared/run `ENDLESS_ROSTER_UNLOCK_FLOORS` false), and
  one new seeded kind joins every floor in every world (`ROSTER.floorsPerKind` 2 -> 1: full roster on floor 10, was
  19); endless, dev and daily replays and scores changed from floor 1 (boards stay `_v1`), `DAILY.ruleset` 16 -> 17 (floor modifiers took 16).
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
  (cap `powerMaxBullets` 100). Tutorial: combat G (room 6 since docs/ARCHER.md AR6 removed combat E, was 7; treasure /
  shrine / stairwell 7-9, were 8-10) with one sniper over a ring, `tutorialPellets` (no power pellet), the sweep lock
  `TutorialSimConfig.pelletLock` (five hashed fields appended to the `tutorial` group; the guard lock's hold), floor-1
  seed 7500 -> 7574 (7511 since AR6), step `pellets` 12 (11 since AR6), funnel revision 3 (`t1r3`, caps 88 / 264; AR6:
  revision 4, `t1r4`, caps 84 / 252). Theme: `pellet.normal` / `pellet.power` (assets and colour roles, placeholder `Block`,
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
  custom event `RunRecap` (37 of 100 names; seconds the panel was open by close
  `retry` / `exit` / `lobby`, near-miss kind, record x skipped; a party run's team totals as rows on the same event)
  from the client remote `runRecap`, re-read by shared/run `readRunRecapReport`, rate limited (`RUN_RECAP_RATE`) and
  taken once per run session the server issued (`RunRecapGate`) by TelemetryService; analytics only. Debug
  `KV_TeamMomentsDebug`, `KV_RetryTiming` (RR8's press -> control print). Vale clips uploaded 2026-11-03 (CM7:
  Success2 + Gold1, Bonus3); Studio check (RR10) and the retry measurement (RR8) pending.

- **Co-op contribution (docs/RUN_CONTRIBUTION.md).** One unhashed sim feed, otherwise presentation, client input and
  telemetry (no hash, replay, fixture, rng, score, leaderboard or lockstep change). `ScoreEvents` gained per-tick
  `popPlayer` (the killer beside `popX`), `dealtPlayer` / `dealtAmount` / `dealtBoss` (`scoreDamageDealt` from
  `damageActor`'s `damageDealt` line, credited to `ctx.playerIndex`: CT0 found every caller binds the damaging player)
  and `hurtPlayer` (`damagePlayer`), scored runs only. `RecapTally` collects them per player with pellets, ground boost
  pickups and death / leave floors. shared/view/hud `contribution.ts` (`contributionOf`: largest-remainder shares,
  standing, one positive title per player by greedy lead, `CONTRIB` / `CONTRIB_TITLES`), `contributionUi.ts`,
  `recapViews.ts` (a count-up per tab). Party runs' run-over: a You / Team / Party strip in the highlights' slot,
  opening on You (owner, CTD1), the Party tab kept (CTD4), no per-player points; Details swaps the whole area; LB / RB,
  Q / E / Tab, taps. Fixed in passing (CT1): the recap's `You` rows read the local player (`RunRecapInput.localIndex`),
  not the spectate view, which a wipe leaves on the last watched teammate. Strings `CONTRIB_STRING_KEYS` (45,
  `run.recap.tab.*` / `.you.*` / `.party.*` / `.title.*` / `.titleDesc.*`; the `daredevil` title reads "Bullet Dancer":
  Daredevil is a boon); contract.luau / validate.luau stay 186 / 197. Telemetry: `RunRecapReport.views` and a `views`
  row on `RunRecap` (still 37 names, 2760 of 8,000 combinations). Studio check
  (CT10) pending.
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
  `cageDepthStuds` nearer the camera. Both sheets uploaded 2026-11-06 (`assetIds.ts`); sounds (TR9), Studio check and
  playtest (TR11) pending.

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
  uploaded 2026-11-04 (ids in `assetIds.ts`). The altar and the coin burst (2026-11-06, presentation only): original pixel art
  from `scripts/art/gen-fortune-art.js` (a round stone altar with an iron fire bowl in the game camera's projection,
  one facing, Pixelated; a greyscale 10-frame coin burst tinted `golden.coin`), each in a sheet of its own
  (`pact-altar.png`, `golden-coin.png`) from atlas group `fortune` (`--only fortune`, generated
  `packs/vale/fortuneLayout.ts`); vale's fourth fx source. PactRenderController draws altar art (an image or a sprite
  set's idle frame) at its own scale (`altarArtFit`, cap `PACTS_VIEW.artMaxHeightTiles` 1; `artHeightTiles` gone) with
  the flame on `PACTS_VIEW.artTopTiles` 0.64, the coal bed. Both uploaded 2026-11-06 (`assetIds.ts`), so the bundled
  vale pack draws them; Studio check pending.

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

- **Boost auras (docs/BOOST_ART.md BAD3).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or
  score change). The Neon discs under a boosted player can draw ORIGINAL pixel art (supersedes BA-P5's tinted Lords of
  Pain ring): `scripts/art/gen-boost-auras.js` (run by `art:build` / `art:lock` before packing, into
  `art/vendor/kaleb-vale/boost-auras/`, like the loot glint) draws Fury a flame ring with embers, Quickstep three
  comets, Frenzy six whirling blades, Aegis six shield plates with a sweeping glint: greyscale (tinted by
  `boost.<kind>`), 8-frame seamless loops, every stack rank drawn natively (ring round((0.55 + 0.14 rank) x 29.6) =
  16 / 20 / 25 / 29 px; never scaled for the stack). Its own sheet `boost-auras.png` (group `boostAuras`,
  `--only boostAuras`, generated `packs/vale/boostAuraLayout.ts`; every other output byte-identical). Theme:
  `boostAuraArt.ts` (own module; contract.luau / validate.luau 186 / 197): on `fx.boost.aura.<kind>` only, `ringPx`
  (per rank, art px) with rank 0 in `play` and rank r in `rank.<r>`, looping, tinted by its own role; `ThemePack.fx(...)
  .ranks`. View: `auraArtFrame` on the pulse's `simSec` (reduced motion holds frame 0), `auraArtStudsPerPixel` (the
  rank's ring exactly on `auraDisc`'s radius, same lifts and cap), `auraArtTransparency` 0.2 + the discs' pulse.
  `BoostAuraController` draws a flat sprite anchor (`createSpriteAnchor`, `FLOOR_CANVAS_YAW`) per kind / rank with art,
  the disc otherwise. Original art: no notices or Credits entry. `boost-auras.png` uploaded 2026-11-06 (`assetIds.ts`),
  so the bundled vale pack draws the auras; Studio check pending.
- **Relic pedestals as chests (docs/TREASURE.md "Relic pedestals as chests").** Presentation only (no sim, dungeon,
  lockstep, hash, replay, fixture or score change). RunMarkerController draws each relic pedestal as the vault chest
  (`treasure.chest`, facing `TREASURE_VIEW.pedestal`) and, once taken, plays the vault's opening (jolt, pop to
  `treasure.chestopen`, solo freeze, `stamp` nudge, ring burst, light column in the Rare floor colour; pure
  `shared/view/treasure` `PedestalChestTracker`); the open chest stays. The chest bodies and column moved to
  `client/controllers/render/treasureBody.ts`, shared with TreasureRenderController. The shrine keeps its cylinder;
  `PROGRESSION_VIEW.pedestalRadiusTiles` and `PEDESTAL_COLOR_ROLE` are gone; `DECOR_FX.glintLiftTiles` 0.7 -> 1.5;
  `tutorial.prompt.relic.*` reworded. Studio check pending.
- **Kenney bookcases (docs/KENNEY_DECOR.md).** Presentation only. Every Kenney piece the plan names is reprojected to
  the game camera (`scripts/art/kenney/reproject.py`, `kenney.json`; 87 PNGs in gitignored `art/vendor/kenney/`); the
  bookcases are wired as the bookcase's alternative art: 14 own PNGs `kenney-bookcase-<look>-x / -z`, vale variants
  3-16 after the kit pair, `DECOR_MAX_VARIANTS` 4 -> 16, and decorPlan's `bookcaseVariant` (one set per room,
  `DECOR_BOOKCASES`, salts `bookcaseSet` / `bookcaseCell`; with only the kit pair the plan is unchanged). Credits:
  Isometric Library, Kenney, CC0. The 14 PNGs uploaded 2026-11-06 (IDs in `packs/vale/assetIds.ts`). **Wide cases
  (KN3):** in a room of the alternative set, two neighbouring cases of a run draw as ONE Kenney wide case, a new decor
  kind `bookcaseWide` (appended last to DECOR_KINDS, low, `DECOR_BOX.bookcaseWide` 13 / 21 / 3 at both pair ends,
  hulled): decorPlan's `bookcasePairs` walks each run (one room, one facing, consecutive along its wall) from its low
  end and pairs a case with the next at `DECOR_BOOKCASES.wideShare` 0.5 by cell hash (salt `bookcaseWide`; look
  `wideBookcaseVariant`, salt `bookcaseWideLook`); the Forge's pieces stay 1 x 1 (no dungeon change). 12 own PNGs
  `kenney-bookcase-<wide look>-x / -z` (reproject.py `stretch` 1.18 along the wall: 1.9 tiles, two narrow cases'
  outer span); without their ids nothing pairs, so the plan is unchanged until the upload. **Floor patches (KN4):**
  decor kind `patch` (flat, appended after `bookcaseWide`), laid by a new last planDecor step (`DECOR_PATCHES`: 2 x 2
  blocks of a room's open floor with a FLOOR ring, no other flat or carpet, not kept out; 1 per 100 floor tiles, 1-3 a
  room, at most 1 in half the boss rooms; salts `patchRoom` / `patchBlock`) only when the pack has patch art. Kenney's
  planks and dirt (no stone: raised blocks read as obstacles), baked per biome by reproject.py (`biomes` /
  `biomeGrade`: mean 35 % of the way from the floor colour, detail x0.55, feathered): 25 own PNGs
  `kenney-patch-<look>-b<n>`; `ValeDecorPiece.biome` maps a piece in one biome only (`VALE_PATCH_LOOKS`). The 12 + 25
  PNGs uploaded 2026-11-06 (IDs in `packs/vale/assetIds.ts`), so the bundled vale pack draws both; Studio check pending.
  **LoP floor blotches (2026-11-08):** biome.1 adds the Lords of Pain ground overlays as floor patches 6 / 7
  (`VALE_ANCIENT_PATCH_ART`, `scripts/art/lop/floor_blotches.py`, own PNGs `lop-patch-blotch1` / `-2`); upload pending.

- **Training dummy art (docs/DUMMY_ART.md).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or
  score change; the dummy keeps its 8 hp, body and corpse time). `enemy.dummy` gets a one-facing pixel-art sprite set
  from the Training Dummy 2D Pixel Art pack (any game use, no resale / redistribution as an asset, no NFTs, credit
  appreciated; author to confirm; raw files in gitignored `art/vendor/training-dummy/`): `dummy.png` (17 cells of
  62x50, `Pixelated`, bodyTiles 1.4) + its rim. Its 7-frame hit wobble outlasts the sim's 0.1 s hit flash, so the view
  times it: `HitReactSlots.hitAge` (seconds since every hit), `ActorSpriteInput.hitClip`, `shared/view/dummy`
  `VIEW_HIT_CLIP_SEC` (only `dummy`, 0.7 s); with a clip `chooseActorAnim` plays `hit` over it and never over the flash.
  Every other set chooses exactly as before. Upload (DA5) and the Studio check (DA7) pending.
- **Legendaries (docs/LEGENDARIES.md).** Gameplay. Two legendary boons appended to `BOONS` (`Boon.OVERKILL` 15,
  `Boon.BASTION` 16; `BOON_COUNT` 17, `CLASSIC_BOON_COUNT` stays 12, so the tutorial's draft is unchanged) and four duos
  appended to `DUOS` (Supernova / Skewer / Citadel / Stone Heart, indices 9-12, card ids 73-76), opt-in through
  `SimConfig.builds` (endless only). New hashed fields appended to the `builds` group: `BuildProc.excess` (the kill's
  carry, Overkill owners only) and per player `braceCount` / `braceReady` / `braceCooldown`. Overkill: `damageActor`
  keeps the hit after the cap and before Executioner, `buildsKillCarry` turns it into the carry (an execute's full hit;
  every gen-0 kill at least `OVERKILL_OWN_HIT_MIN` 1; bosses never), passed through the transient, unhashed
  `SimCtx.killCarry`; the streak (`overkill`, `KillCause.OVERKILL`) strikes the nearest enemy within 4 tiles for the
  carry as is (no `playerHitDamage`); Chain Reaction now cross-triggers on SPARK / BURST only. Bastion: `RunMods.bastion`
  (the sword reads its guard through `swordGuardTicks` / `swordGuardSweepCos`: SWORD_DATA's numbers exactly without it;
  `swordGuard(slot, guardTicks)` clamps to 1); a roll brace marks an enemy bullet's unused payload `lastHit` (1), set
  only by a Bastion roller, so runs without Bastion hash as before; a brace with nothing to restore is not spent
  (`BraceKind.SPENT` unused); Citadel waits 5 s between braces. Feed (unhashed `BuildEvents`): `overkill*`, `bracePlayer`
  / `braceKind`, Supernova / Skewer `duoProc` entries. Theme: role `build.overkill` `#ffe0b0` (`buildReport`), strings
  `boon.overkill.*` / `boon.bastion.*` / the four `duo.*`, `hud.toast.brace` / `.braceHeal`, `fx.brace.text`, port audio
  IDs `sfx.build.overkill` / `.brace` (SILENT in the placeholder, `SFX_FALLBACK` to the spark / the Aegis break); no
  Luau-locals change. View: Overkill streaks and impact flashes, the guard drawn as a full ring, the brace ring, BRACED
  shout (`FLOOR_SHOUT_PRIORITY.brace`), armor pulse and toasts. `DAILY.ruleset` 8 -> 9. M1, every fixture and the
  tutorial replay exactly as before; endless replays and scores changed (boards stay `_v1`). Tuning measured (LG7) and
  the owner's changes applied (2026-11-06; later the brace threshold `BASTION_BRACE_BULLETS` 3 -> 8, `DAILY.ruleset`
  9 -> 10; then LGD15, 2026-11-19: the brace adds up 10 bullets over a room's guards and rolls (new hashed
  `braceTotal`, appended last to `BUILD_PLAYER_SCALARS`), still once per room, spent with nothing restored at full
  armor, `DAILY.ruleset` 24 -> 25); Studio check, art (LG8) and audio pending.

- **Hazard art (docs/HAZARD_ART.md).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score
  change). Supersedes docs/PROJECTILE_ART.md PAD3 for the strike and the embers: `BULLET_ART.decalIds` is gone,
  `hazardSpriteIds` (`bullet.enemy.strike`, `bullet.player.ember`) may take a one-facing greyscale `sprites` set (the
  strike `flash` / `scorch` and its hit rim `rimPx`, never `radiusPx`: the gameplay-key guard; the ember `burn` and its
  patch `lit`), held to `hazardArt.ts` `hazardArtReport` (folded into `variantColorProblems`), read with
  `ThemePack.hazardSprite`. Original art by `scripts/art/gen-hazard-art.js` (run by `art:build` / `art:lock`) into
  `art/vendor/kaleb-vale/hazards/`, its own sheet `hazards.png` (group `hazards`, `--only hazards`, generated
  `packs/vale/hazardLayout.ts`). View: `shared/view/hazards.ts` / `HAZARD_ART_VIEW`; the strike is top-down art laid
  flat unstretched (its rim on `STRIKE_BULLET_RADIUS`), tinted `enemyBullet`, flipped by slot bits, and leaves a 0.8 s
  scorch (view-only `ScorchTracker`, sim seconds, dropped on a floor change); the ember is 3/4 art sized by the goo's
  cover rule, tinted `build.ember`, its loop phased per slot. Client `HazardSpritePool.ts`; `DecalPool` takes any
  `FloorSpriteDrawer` and a per-frame `HazardClock`. Without a `hazards.png` id every pack draws the discs exactly as
  before. No new colour role, string, sound or setting; no Luau-locals change. `hazards.png` uploaded 2026-11-06
  (HA7, `assetIds.ts`), so the bundled vale pack draws them; Studio check (HA8) pending.

- **Gamepad menus (docs/GAMEPAD_MENUS.md).** Client input and presentation only (no sim, dungeon, lockstep, hash,
  replay, fixture or score change). Pure core in shared/view/menu (`focus.ts` `FOCUS_LAYERS` / `pickFocusScope` /
  `focusAction` / `FocusMemory` / `CorePromptGuard`, `padActions.ts` `PAD_SURFACES` / `menuPadAction` / `PadHoldGate`,
  `padHints.ts`, `padNav.ts`, `padScroll.ts`, `padFeedback.ts`; tunables `GAMEPAD_MENU` / `MENU_HAPTICS`).
  `FocusController` owns the pad for the topmost scope (`useFocusScope` / `<FocusScope>` in client/ui/focus;
  `useGamepadFocus` and the hand-rolled selection effects are gone), hides Roblox's selection image, routes pad B
  (MenuController keeps Backspace; Settings / Leaderboard controllers no longer handle B), and skips while a CoreGui
  prompt holds the selection. `InputController.onMenuPadInput` (LB/RB/LT/RT/X/Y/right stick, sunk, driver keys still
  reported) and `blockHeldPadInputs` (on resume and when a shown menu closes: `selectMenuShown`, the menu without the
  stage cover / loading screen). `PadHintBar` (Roblox `GetImageForKeyCode` glyphs), `PadHapticsController`
  (HapticService motors; now `HapticsController`, docs/HAPTICS.md), `ConsoleController` (chat off on a ten-foot
  interface), MenuFit's TV-safe inset. Setting
  `DisplaySettings.padVibration` (default On, only Off stored, doc stays v2; the Display reset keeps it); strings
  `PAD_HINT_STRING_KEYS` (`pad.hint.*`) and `options.controls.vibration`. Spike `KV_PadSpike` (GM0), debug
  `KV_FocusDebug`. Studio check (GM0 results, GM8, GM11) pending.
- **Wall slide (port retune, 2026-11-07, docs/WALL_SLIDE.md).** Gameplay (sim, every world). The player's
  `SimConfig.moveResolver` is `playerMover(d)` (shared/run `playerMover.ts`): `playerSlideMover(d, PLAYER_RADIUS)` =
  shared/dungeon `slideCircle` (collide and slide: the deepest overlap pushed out along the closest point's normal, so
  corners are rounded by the body's radius; a corner tie-break; a face assist within `assistTiles` 0.35 of a wall's end,
  only toward the end the move leans to; never farther than the step or against the input, else `moveCircle`'s result)
  instead of the web build's `circleMover` (per-axis sweeps that stop dead on corners). Tunables `PLAYER_SLIDE`
  (`slideData.ts`: iterations 4, `tieShare` 0.05, `tiePush` 0.3, `assistTiles` 0.35, `assistStallShare` 0.2,
  `pillarSlip` true). The pillar slip: an isolated 1 x 1 blocker (all 8 neighbours open: every solid pillar, a lone
  crate or candle stand) is slipped round across its whole face, to the side the move's ray passes its centre unless
  that is against the move's lean (WSD3, WSD7). M1 included (WSD1): `buildRunConfig`'s dungeon worlds, endless, daily,
  dev, co-op and the tutorial all build it (the kind is read when the config is built and kept for every floor of the
  run). The web mover survives only as `PlayerMover.WEB`: every golden fixture and web-tuned spec (validate, segments,
  runFull, runBoss, runBullets, score.replay, constants, recordingCodec, bossAct1.ttk, liveRun.forfeit, roomEdgeState)
  replays under `setPlayerMover(PlayerMover.WEB)` next to `setSwordTimings(WEB_SWORD_TIMINGS)` / `setSwarmerHp` /
  `setBossHp(WEB_BOSS_HP)` and still matches bit for bit. Bullets, sight, enemy movers, the dungeon, the hash layout and the lockstep wire are
  unchanged; the server validator builds the same config. Live replays and scores changed in every world (M1 runs
  recorded by older builds no longer replay; the pins that record player paths were re-recorded, docs/WALL_SLIDE.md
  WS4); the all-time boards stay `_v1`; `DAILY.ruleset` 9 -> 11 (main's brace threshold took 10). Snag census
  (`run/snagCensus.<n>.spec.ts`, WS5): zero unexcused stalls with the slide in every class. The new paths exposed a latent
  imp bug (a blink could land on a POOL tile, which bullets cross): `impBlinkValid` now reads the new optional
  `SimConfig.isBodyBlocked` (`bodyBlocker(d)`, endless floors; `isBulletBlocked` without it). Debug `KV_CollisionDebug`
  (presentation only: blocking cells, isolated blockers, the body ring, a stall flash). Playtest (WS8) passed
  2026-11-07; stepped-wall smoothing (WS3) pending.
- **Boon icons (docs/BUILDS.md BU11, the boons part, 2026-11-08).** Presentation only (no sim, dungeon, lockstep, hash,
  replay, fixture or score change). One 16 x 16 icon per boon, ORIGINAL pixel art by `scripts/art/gen-boon-icons.js`
  (character maps in the UI sheet's palette, auto-outlined; run by `art:build` / `art:lock`) into
  `art/vendor/kaleb-vale/boon-icons/`, packed by the atlas pipeline's new group `boonIcons` (buildUiIcons' packer, its
  OWN sheet `boon-icons.png`, `--only boonIcons`, generated `packs/vale/boonIconLayout.ts`), so `ui-icons.png` does not
  repack. Theme: optional free-form ui ids `ui.boon.<name>` (`shared/theme` `boonIconId`, the boon id's name
  lower-cased: asset ids are lowercase), all or nothing on the sheet's one ID (vale `VALE_BOON_ICON_SOURCE`). View:
  `ItemCellModel.art` / `itemCellArt` (the items row: the art on `ITEM_ART_FILL_ROLE` with the rarity / duo role as the
  outline and pip colour) and `DraftCardModel.chipArt` / `draftChipArt` / `draftChipCells` (the banner row's chip: a
  Duo's two halves as art, a boon card's own icon in a one-cell chip). Without the art every cell, chip and card is
  exactly as before (labels; a boon card has no chip). Evolutions show their boon's icon; duos their two boons'. No
  new strings, roles, sounds or settings; no Luau-locals change. `boon-icons.png` uploaded 2026-11-08 (`assetIds.ts`),
  so the bundled vale pack draws the icons; the Studio check (banner row width on the longest Evolution banner, the
  phone column) pending.
- **Relic and curse icons (docs/BUILDS.md BU11, the relic and curse part, 2026-11-08).** Presentation only (no sim,
  dungeon, lockstep, hash, replay, fixture or score change). One 16 x 16 icon per relic and per curse,
  ORIGINAL pixel art by `scripts/art/gen-item-icons.js` (the boon icons' kit and palette; curses in an added sickly
  plum / bile green; run by `art:build` / `art:lock`) into `art/vendor/kaleb-vale/item-icons/`, packed by a new atlas
  group `itemIcons` into its OWN sheet `item-icons.png` (`--only itemIcons`, generated
  `packs/vale/itemIconLayout.ts`), so `ui-icons.png` and `boon-icons.png` do not repack. Theme: optional free-form ui
  ids `ui.relic.<name>` / `ui.curse.<name>` (`shared/theme` `relicIconId` / `curseIconId`, lower-cased), all or
  nothing on the sheet's one ID (vale `VALE_ITEM_ICON_SOURCE`). View: the items row's relic / curse cells carry `art`
  like the boons' (`runItemCells`, `itemCellArt`): the icon on the dark cell, the relic / curse role as its outline, no
  curse skull behind a curse's own icon; without the art every cell is exactly as before. No new strings, roles,
  sounds or settings; no Luau-locals change. `item-icons.png` uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale
  pack draws them; the Studio check pending.
- **Boost icons (docs/BOOSTS.md "As built: boost icons", 2026-11-08).** Presentation only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). One 16 x 16 icon per temporary boost (Fury an angry flame, Quickstep a winged
  boot, Frenzy crossed daggers, Aegis a round ward with the Aegis diamond), ORIGINAL pixel art by
  `scripts/art/gen-boost-icons.js` (the boon icons' kit and palette plus a ramp per boost around its `boost.<kind>`
  role; run by `art:build` / `art:lock`) into `art/vendor/kaleb-vale/boost-icons/`, packed by a new atlas group
  `boostIcons` into its OWN sheet `boost-icons.png` (`--only boostIcons`, generated `packs/vale/boostIconLayout.ts`).
  Theme: optional free-form ui ids `ui.boost.<kind>` (`shared/theme` `boostIconId`), all or nothing on the sheet's one
  ID (vale `VALE_BOOST_ICON_SOURCE`). View: `BoostRow` (status panel and touch strip) draws `boostIconArtId(kind)` on
  `BOOST_VIEW.iconArtFillRole` with the kind's role as the outline, blinking with the bar; without the art every cell
  is exactly as before (colour square and label). No new strings, roles, sounds or settings; no Luau-locals change.
  `boost-icons.png` uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them; the Studio check pending.
- **Armor pips (docs/UI_ART.md "As built: armor pips", 2026-11-08).** Presentation only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). The armor row's pips as ORIGINAL 16 x 15 pixel art (the hearts' 18 x 15
  height) by `scripts/art/gen-pip-icons.js` (the boon icons' kit; run by `art:build` / `art:lock`) into
  `art/vendor/kaleb-vale/pip-icons/`: heater shields on one silhouette, `ui.pip.armor` (steel round the armor blue,
  `uiMana`), `ui.pip.armor.empty` (hollow and cracked, its own state) and `ui.pip.aegis` (the Aegis lavender with a
  white diamond, untinted). Packed by a new atlas group `pipIcons` into its OWN sheet `pip-icons.png` (`--only
  pipIcons`, generated `packs/vale/pipIconLayout.ts`), so `ui-icons.png` does not repack. Theme: optional free-form ui
  ids `PIP_ICON_IDS` (`shared/theme` pipIcons.ts), all or nothing on the sheet's one ID (vale `VALE_PIP_ICON_SOURCE`).
  View: `shared/view/hud` `pipArt` prefers them (both armor ids, or the Aegis id) over the UI sheet's chips (the combo
  shards keep the white chip) and draws them like hearts, in the hearts' whole 24 reference px box
  (`HUD_SKIN.shieldPipBox`, `PipArt.box`; the touch strip's `TouchStripArt.pipBox`), so they are spaced like the
  hearts (owner, 2026-11-08); without the art every pip is exactly as before. No new strings, roles, sounds or
  settings; no Luau-locals change. The first 9 x 9 sheet's upload (2026-11-08) is retired with its rects; the 16 x 15
  `pip-icons.png` uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them; the Studio check pending.
- **Duo icons (docs/BUILDS.md BU11, the duo part, 2026-11-08).** Presentation only (no sim, dungeon, lockstep, hash,
  replay, fixture or score change). One 16 x 16 icon per duo (all 20), ORIGINAL pixel art by
  `scripts/art/gen-duo-icons.js` (the boon icons' kit and exactly their palette; each icon draws what the duo does in its
  two boons' colours; run by `art:build` / `art:lock`) into `art/vendor/kaleb-vale/duo-icons/`, packed by a new atlas
  group `duoIcons` into its OWN sheet `duo-icons.png` (18 x 360, one append-only column in DUOS order like the boon
  sheet's `order`; `--only duoIcons`, generated `packs/vale/duoIconLayout.ts`), so no other icon sheet repacks. Theme:
  optional free-form ui ids `ui.duo.<name>` (`shared/theme` `duoIconId`, lower-cased), all or nothing on the sheet's one
  ID (vale `VALE_DUO_ICON_SOURCE`). View: `runItemCells`' optional trailing `has` (the pack's image lookup): a duo whose
  own icon the pack has is one cell (`span` 1, outline `boon.duo`), else the two-cell chip; `DraftCardModel.duoArt`:
  `draftChipArt` / `draftChipCells` give the Duo card's chip that one icon in one cell, else the halves. The New card's
  duo hint keeps the boons' labels. Without the art every cell and chip is exactly as before. No new strings, roles,
  sounds or settings; no Luau-locals change. Upload of `duo-icons.png` (its ID into `assetIds.ts`) and the Studio check
  pending.
- **Graves (docs/DECOR.md "Graves", 2026-11-08).** Presentation only (no sim, dungeon, lockstep, hash, replay, fixture
  or score change; DECOR_BOX.grave and the decor plan unchanged). The Forge's `grave` props (grim graveyard rooms, far-wall
  tops) draw five ORIGINAL gravestones in the Lords of Pain props' style by `scripts/art/gen-grave-art.js` (SDF models
  rendered from the game camera like render_kit.py's kits: 6 x 6 rays a pixel, the kit sun, the kits' grade; run by
  `art:build` / `art:lock`) into `art/vendor/kaleb-vale/grave/`: rounded headstone, cross, cracked slab, obelisk, skull
  headstone with moss, each facing the camera (28 degrees toward its lit side) so one image serves either far wall.
  World art `grave-<look>` (own PNGs: `decor-atlas.png` does not repack), vale `decor.delve.b<n>.grave` variants 1-5 in
  every biome; each fits DECOR_BOX.grave at full size (`gen-grave-art.test.js`). Not on the void's shoulder. The five
  `grave-*.png` uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them; the Studio check pending.
- **Co-op frame pacing (docs/FRAME_PACING.md).** Client timing and presentation only (no sim, dungeon, hash, replay,
  wire, fixture or score change; the server is unchanged: every client still steps exactly the merged log, only WHEN
  changes). shared/lockstep `pacer.ts` `PlayoutPacer`, a playout clock: merged frame k is stepped at local time k x
  SIM_DT + P from a small jitter buffer (base = the smallest arrival offset over 10 s, depth = the 95th-percentile
  jitter over 4 s + `marginTicks`, clamped to 3..12 ticks), one tick per 16.7 ms at any render rate, alpha in [0, 1);
  a hold (views frozen on the newest state, never extrapolated) when a due frame is missing; slews at 5 % (10 % past 6
  ticks); catches up at `maxCatchup` after a client hitch, whose arrivals stay out of the windows. Tunables `PACING`
  (config.ts); `PACING.marginTicks` is 1.5, raised from the planned 0.5 by FP4's measurement (harness arrivals are
  handled on whole rendered frames, so an offset can read a whole tick late; 0.5 held about once a second). Opt-in per
  client through `LockstepTunables.pacing` (`DEFAULT_LOCKSTEP.pacing` = `PACING`; undefined = step on arrival, as the
  older network specs assert): `receive(firstTick, data, now?)` / `pump(dt, sample, now?)` take the local clock
  (SimController: `os.clock()`), pacing turns on at the first pump given `now`, `getAlpha()` is the pacer's, and the
  input lead covers the buffer (`nextInputTick()` = tick + `netLead()` + depth; `inputLead()` the effective lead,
  `isPacing()`, `pacingStats()`). The lead fix (FP1): a step whose target was already sent sends nothing, so the
  effective lead falls back after a spike (it had stayed at the run's highest lead). `KV_PacingOff` (Workspace,
  `RUN_ATTRIBUTES.pacingOff`, read at each co-op start) builds the client without pacing for an A/B. KV_Debug: the
  co-op debug line shows the effective and net lead and a pacing part (docs/FEEL.md J9; developer strings
  `hud.debug.pace` / `.paceWait` / `.paceOff`), and shared/lockstep `ArrivalLog` (created only under KV_Debug) prints a
  `[Pace]` line every `ARRIVAL_LOG.windowSec` (10 s): batch gaps p50 / p95 / max, sizes, the pacer's numbers, the leads
  and misses, render fps. Spec harness: paced at 60 fps over 20-120 ms, 99.7 % of frames step one tick (unpaced 0 %).
  Studio check, FP0 (a measured real session) and FP6 (playtest) pending; FP7 optional.
  **Revision 2 (2026-11-09): the lead from measured trips** (FP9-FP13). Client timing plus one wire field (no sim,
  dungeon, hash, replay, log, validator, fixture or score change). `lockstepFrames` gains a trailing `echo` (8 bytes,
  `wire.ts` `encodeInputEcho` / `decodeInputEcho`): the recipient's own worst input since the last broadcast (lowest
  slack, `session.ts` `submitInput(..., now)`), its lates and a `catchingUp` flag; the service fires once per member
  (FPD14: no client sees a teammate's slack) and logs `LOCKSTEP_INPUT` per player once per run. Pure `lead.ts`
  `LeadController` (tunables `LEAD`, `LockstepTunables.lead`; undefined = the old miss counter exactly): net lead =
  `ceil(p95 of 5 s of net trips + 1.5)`, up at once, a late bumps to its own trip, down a tick per 0.25 s after 1 s
  below a target 0.75 higher; hitch / server catch-up / over-cap-depth lates excused; old rule without echoes (2 s
  timeout). `LockstepClient` `receive(..., echo?)`, `InputSampler = (sending) => InputFrame` (a fall's skipped sample's
  buttons are OR-ed into the next frame sent), `mismatches`, `leadStats()`. `KV_LeadOff` (`RUN_ATTRIBUTES.leadOff`).
  Debug strings `hud.debug.lead` / `.leadLegacy` / `.leadOff`, trip columns on the `[Pace]` line. Spec networks: lead
  11-12 / 15-17 ticks (old rule ~16 / ~22-25), no lates after the warm-up, back within seconds after a spike. FP14 /
  FP15 (owner) and the Studio checks pending.
  **Revision 3 (2026-11-10): a steady lead on jittery links** (FP17-FP20, FP22, FP23). Client timing only (no sim,
  dungeon, hash, replay, wire, server, fixture or score change; the echo, the pacer, the send rules and the tap latch
  are unchanged). `LeadController` gains the capped cover (Design 13): a second trip window (`LEAD.coverWindowSec` 15,
  `coverPercentile` 0.99) and a ceiling (constructor argument, undefined = no cover; `LockstepClient` passes
  `tunables.prediction?.maxTicks`, so no prediction / `KV_PredictOff` = no cover, FPD19): L* = `max(ceil(p95 / 5 s +
  1.5), min(ceil(p99 / 15 s + 1.5), ceiling - the newest send's depthUsed))`, the fall target the same plus 0.75, the
  cover ignored in the warm-up; a late never bumps (`LEAD.lateBump` false, FPD15), it is only counted. `LeadStats` gains
  `baseTarget` / `coverP99` / `coverTarget` / `ceiling`. `KV_LeadBump` (`RUN_ATTRIBUTES.leadBump`, read at each co-op
  start, ignored with `KV_LeadOff`) builds the client with `lateBump: true` (with prediction on: the bump on top of the
  cover). Debug: `hud.debug.lead` reads `trip p95 / p99`, the `[Pace]` lead part `lead {l}t target {L*}t (base {Lb}t
  cover {Lc}t cap {C}t) fall {Lf}t`. The opt-in census (`lead.census.spec.ts`, `--census`) runs Revision 2 as `today`
  and the controller as `rule3` (since FP23 with `episodes` off), equal to the plan's `cov20` frame for frame; on the
  owner-like links it keeps today's lead with 0-47 % fewer dropped changed inputs, a sixth to a quarter of the churn and
  29-50 % of the felt delay at cap 20 (FPD18's gates met and asserted, `owner2` within 0.01 t). The cost: with
  prediction on, a spike longer than a burst holds the lead at `min(Lc, C)` for the cover's whole 15 s window, then the
  1 s hold and 0.25 s a tick (FP1's echoing scenario back in 19.92 s, Revision 2 9.55 s; the census's `cleanspike`
  17.92 s, today 8.05 s, failing FP12's back-within bound there; FP12's dropped clause fails under FPD15, printed only); the
  knight feels nothing under the cap, hits, enemies and teammates run that lead behind; a depth rise of k puts the
  effective lead at cap + k for ~1 + 0.25 k s. FP23 (FPD20, owner 2026-11-10): the episode detector (`LEAD.episodes`,
  only with a ceiling and without `lateBump`): a trip more than max(`episodeGapMs` 40 ms, `episodeIqrK` 3 x the cover
  window's IQR) over the base window's median is slow; slow trips (up to `episodeGapSamples` 2 others between) spanning
  more than `episodeMinSec` 0.25 s and at least `episodeMinSlow` 6 are an episode, taken out of the cover and kept out
  while it lasts (bursts on top of it enter; the base keeps every trip), so `cleanspike` is back in 8.05 s again and the
  owner-like links are `cov20` frame for frame (`LeadStats.episodes` / `episodeActive` / `keptOut`, the `[Pace]` line's
  `episodes {n} out {k}`; the census's default `rule4` asserted equal to `ep25mnt`, `rule3` = `episodes` false). Left: a
  spike over ~2.5 s moves the base median and is held like the cover's; one under 0.25 s or 6 slow trips is remembered
  like a burst; a bimodal link can keep an episode on indefinitely (the base's p95 covers it; the episode's level keeps
  at most a cover window of slow trips). FP21 (owner: Studio 4G with and without `KV_LeadBump`; its `miss` criterion
  against `KV_LeadBump`, which with prediction on is the cover plus the bump, is an open owner question) pending.
- **Builds v2, wave 1 (docs/BUILDS_V2.md).** Gameplay, opt-in `SimConfig.builds` (endless only). Three boons appended
  to `BOONS` (`Boon.RIPOSTE` 17 rare, `BALLISTA` 18 rare, `WRECKER` 19 common; `BOON_COUNT` 20, `CLASSIC_BOON_COUNT`
  stays 12, so the tutorial's draft is unchanged; evolutions Counterstrike / Siege Bolt / Demolition) and seven duos
  appended to `DUOS` (Thunder Guard, Stillwater, Rebuke (Bastion + Riposte), Dragon Bolt, Powder Keg, Full Heart, Happy
  Hour: indices 13-19, card ids 77-83); `BuildEffect.BALLISTA` / `WRECKER` / `RIPOSTE` 9-11, `ProcKind` { `KILL` 0,
  `SMASH` 1 }, `BreakableSource.ROLL` 4 / `BUILD` 5 (scored like a swing, BVD12), `ScoreSource.OVERCAP` 15 (builds runs
  only: `addOvercapScoreSources` pads every earlier gated source, so every builds run holds 16 sources; a scored run
  without builds keeps its sources and hash). Hashed fields appended to the `builds` group: per player `riposteCount`,
  `overcap`, `happyHourTicks`, `rebukePending`; `BuildProc.kind`; then `pins` (`BuildPin`), `waves` (`BuildWave` with
  its `hits` ids) and the world scalars `stillCombo` / `stillTick` (`clearBuildProcs` clears pins and waves, the
  Stillwater record and every `riposteCount` / `rebukePending` at the floor change). Riposte: a guard that runs its full
  length (BVD3; a roll or a swap discards the count) sends a counter-wave, an expanding hashed sweep (BVD1: no bullet
  slot or arc row, each enemy once, `stepWaves` first in `stepBuilds`), Counterstrike's ring + shard returns at 5
  erased. Ballista: a heavy arrow bursts on its last pierce (a ring on the struck enemy's hit circle) or a wall /
  unbroken piece (a back fan), `bowChargeTicks` through `RunMods.ballistaChargePercent` (27 ticks at II-III); Siege
  Bolt pins the first enemy it hits and does not kill (never a boss, the Goldling, a reviver or the dummy; one pin per
  arrow, BVD6), drags it in a new `stepCombat` phase 5b with `moveActor`, holds its AI through a transient pinned mask
  (`SimCtx.pinMask`, rebuilt from `state.builds.pins` at the start of `stepActors`, never hashed), plows without
  spending pierce while it carries (BVD7) and slams it into a wall (300 %, a shockwave, pieces broken as `BUILD`).
  Wrecker: the roll smashes pieces before its move (`rollSmashBreakables`), `damageBreakable` takes an owner and a gen,
  and every piece the owner breaks queues a smash proc (splinters, the combo refill; Demolition's blast chains piece by
  piece up to `GEN_MAX`; Powder Keg fires the on-kill boons from it). Overcap: the damage a boss's cap drops pays
  `OVERCAP_POINTS` into OVERCAP at the kills' floor scaling (`buildsOnOvercap` in `damageActor`, combo-neutral). Port arc
  rows 6 / 10 @ FULL_RING and 6 / 10 @ 1.6 (`combat/arcTablePort.ts`). Feed: unhashed `BuildEvents` (`wave*`,
  `ballista*`, `pinStart*` / `pinEnd*`, `slam*`, `smash*`, `demolition*`, `beam*`, `happyPlayer`, `overcap*`, Thunder
  Guard sparks as `SparkFork.THUNDER`). Duo hint (BV8, presentation): `duoUnlockedBy` / `draftDuoHint` on New cards.
  Theme (BV10): colour roles `build.counter` `#00ff8c` / `build.overcap` `#fff0b0` (`buildReport`; the overcap gold also
  >= 40 CIE76 from `newBest`, `BUILD_APART_RULES`), strings `hud.draft.duoHint`, `fx.counter.text` / `fx.pinned.text` /
  `fx.slam.text`, `hud.toast.happyHour` (`BUILD_STRING_KEYS`) and `score.source.overcap`, port audio IDs
  `sfx.build.counter` / `.pin` / `.slam` / `.smash` / `.beam` (SILENT in the placeholder, `SFX_FALLBACK` to the parry,
  the bow's full charge, a Charger's wall stun, the breakable break, the spark); `contract.luau` / `validate.luau` stay
  186 / 197. `DAILY.ruleset` 11 -> 12. M1, every golden fixture and the tutorial replay exactly as before; endless
  replays and scores changed (boards stay `_v1`). View (BV11, presentation only): pure core in shared/view/fx
  (`BuildFxEvents` collects every wave 1 list per tick; planners `CounterWaveFx`, `BowFx`, `WreckerFx`, `HeartBeamFx`,
  `HappyHourFx`, `OvercapPops`, `WaveOneRings`; tunables `BUILDS_V2_FX`; `FLOOR_SHOUT_PRIORITY.counter` / `.pinned` /
  `.slam` 0.5; cue mappings for the five sounds, the parry tick climbing per bullet for a Riposte owner,
  `ScorePopTone.HAPPY` in `fx.heal`) and the controllers `CounterWaveController`, `SiegeFxController` (the pin's sprite
  hold through `ActorRenderController.setPinHolds`, the slam's solo 40 ms freeze and `stamp` nudge),
  `WreckerFxController`, `HeartBeamController`, `HappyHourController`, `OvercapPopController` (pops duck near bullets,
  `overcapPopDuck`). Tuning (BV12), art / audio and the Studio checks (BV11 checklist, BV13) pending.

- **Molten tiles (docs/ART.md "As built: molten tiles", 2026-11-08).** Presentation only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). The molten biome (`biome.2`) gets a repeating floor and wall texture,
  ORIGINAL art (basalt with bright red lava in the cracks) by `scripts/art/molten/gen_molten_tiles.py` (python3, numpy +
  Pillow; not run by `art:build`) into `art/vendor/kaleb-vale/molten/`: images `tile.biome.2.floor` / `.wall`
  (`tile-biome2-floor.png` / `-wall.png`, 256 x 256, seamless, `tilesPerImage` 4, means `#2d211e` / `#342622`). The
  pipeline writes `VALE_TILE_MEAN_HEX` (asset id -> mean colour of every `meanHex` image; `VALE_FLOOR_HEX` is now
  `tile.biome.1.floor`'s by id) and refuses `tilesPerImage` without `meanHex`. Manifest: an uploaded repeating floor or
  wall texture makes its mean that surface's biome colour; every textured surface keeps its biome's rough material
  (validator: a textured floor or wall must not be SmoothPlastic or Glass; the Studio check found SmoothPlastic's sun
  glint washes textured faces out at the game camera, biome.1's stone floor included, so it is now on Pavement).
  WorldController: a repeating wall image gives every wall Part 5 Textures (`GAME_WORLD.wallTextureFaces`, Top + 4
  sides) in the biome's wall material, world-anchored by shared/view
  `wallTextureOffsets` (side-face conventions assumed in `GAME_WORLD.wallTextureUV`); without one walls draw as before.
  Both PNGs uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them; the Studio checks (no seams at
  wall joins, stone upright on side faces, telegraph rings readable on molten floors: the lava's hottest pixel is 31
  CIE76 from `telegraph`) pending; the biome.2 Kenney floor patches still bake toward the old `#2a1a16` (optional
  rebake).
- **Frost tiles (docs/ART.md "As built: frost tiles", 2026-11-08).** Presentation only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). The frost biome (`biome.3`) gets a repeating floor and wall texture, ORIGINAL
  art (dark slate with snow-packed joints, rime, hoarfrost; coursed blocks with snow tops and icicles) by
  `scripts/art/frost/gen_frost_tiles.py` (python3, numpy + Pillow, the molten script's helpers; not run by
  `art:build`) into `art/vendor/kaleb-vale/frost/`: images `tile.biome.3.floor` / `.wall` (`tile-biome3-floor.png` /
  `-wall.png`, 256 x 256, seamless, `tilesPerImage` 4, means `#222a32` / `#303941`), through the molten tiles' pipeline
  unchanged; materials stay Snow / Glacier. Both PNGs uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws
  them; the Studio checks (Glacier's glint under the wall texture) pending.
- **Grim tiles (docs/ART.md "As built: grim tiles", 2026-11-09).** Presentation only (no sim, dungeon, lockstep, hash,
  replay, fixture or score change). The grim biome (`biome.4`, the Grim Vaults) gets a repeating floor and wall texture,
  ORIGINAL art in the Lords of Pain ground's style (dark violet-grey crypt slabs with worn corners, cracks, a broken slab,
  an engraved grave slab and dim grave moss in the joints; mixed-height crypt masonry with damp streaks, moss caps and
  tendrils) by `scripts/art/grim/gen_grim_tiles.py` (python3, numpy + Pillow, the molten script's helpers; not run by
  `art:build`) into `art/vendor/kaleb-vale/grim/`: images `tile.biome.4.floor` / `.wall` (`tile-biome4-floor.png` /
  `-wall.png`, 256 x 256, seamless, `tilesPerImage` 4, means `#212023` / `#353338`), through the molten tiles' pipeline
  unchanged; materials stay Slate / Cobblestone. Both PNGs uploaded 2026-11-09 (`assetIds.ts`), so the bundled vale
  pack draws them; the Studio checks pending.
- **Verdant tiles (docs/ART.md "As built: verdant tiles", 2026-11-09).** Presentation only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). The verdant biome (`biome.5`) gets a repeating floor and wall texture,
  ORIGINAL art (dark grey-green limestone flagstones with moss in the joints, moss cushions, grass tufts, leaf litter and
  lichen; coursed limestone blocks with moss caps, lichen and trailing ivy) by `scripts/art/verdant/gen_verdant_tiles.py`
  (python3, numpy + Pillow, the molten script's helpers; not run by `art:build`) into `art/vendor/kaleb-vale/verdant/`:
  images `tile.biome.5.floor` / `.wall` (`tile-biome5-floor.png` / `-wall.png`, 256 x 256, seamless, `tilesPerImage` 4,
  means `#1e2a1a` / `#273125`; the floor's 4.3 CIE76 from the shoulder is the tight margin), through the molten tiles'
  pipeline unchanged; materials stay Grass / Limestone. Both PNGs uploaded 2026-11-09 (`assetIds.ts`), so the bundled
  vale pack draws them; the Studio checks (Grass's pattern under the floor image) pending.
- **Kenney Forge pieces (docs/KENNEY_DECOR.md KN5-KN9, 2026-11-08).** Gameplay (dungeon), the `solidDecor` Forge
  option (endless only). `SolidDecorKind` gains `studyTable` (2 x 2), `display` (2 x 1), `lectern` (1 x 1),
  `fallenShelf` (2 x 1, low), `diningTable` (1 x 1), `barrelStack` (2 x 1, flush), `crateStack` / `lumber` /
  `barrelHeap` (1 x 1, flush, corners first) and `stockpile` (2 x 2, tall, big storerooms); `table` / `chair` stay in the
  union but are no longer placed. Library v2: the study table replaces the reading line (KND12, same `readingArea`
  placement and pillar clearing), a 1-wide carpet runner (`Dungeon.carpets`, up to 12 tiles in 2-tile segments) from a
  lectern (the statue roll removed), display cases and a toppled case. A new combat / elite theme `mess` (weights grim
  0.08 / other 0.12; barrel stacks flush, then dining tables Chebyshev >= `tableSpacing` apart; breakables x1.5,
  `BREAKABLE.mess.countScale`; a room where nothing fits is dressed as plain). Storerooms place 1-3 stock pieces before
  their breakables. Free-standing pieces may clear solid pillars (`Dungeon.clearedPillars`). solidDecor.spec: the floor
  stays one piece, no new one-tile pinch. Endless layouts, spawns, replays and scores changed (boards stay `_v1`; the
  roomPool.lock digests, vault, charger and stormcaller pins re-recorded); `DAILY.ruleset` 12 -> 13. M1, every fixture
  and the tutorial replay exactly as before. Presentation (KN9): the 51 new Kenney PNGs pack into ONE `kenney-decor.png`
  (atlas group `kenney`, `--only kenney`, generated `packs/vale/kenneyLayout.ts`); decor kinds `studyTable` ..
  `stockpile` and `libraryCandle` (a library's candle stand, presentation only) appended after `patch`; carpet runner
  variants 5-10 (segments along X / Z, ends toward +X / +Z / -X / -Z); `DECOR_KENNEY` look picks by cell hash; a
  stockpile's back cells join `behindShelf`. Without the sheet's ID the pieces block and draw nothing, and floors
  without the new kinds plan exactly as before. Credits: Kenney Isometric Library / Dungeon (CC0). No Luau-locals
  change. `kenney-decor.png` uploaded 2026-11-08 (KN12, `assetIds.ts`); the Studio check (KN13: the toppled case's Z
  art and the 1 x 1 stock's facings were picked by eye) pending.
- **Stage assets (docs/STAGE_ASSETS.md, 2026-11-09).** Presentation and client input only (no sim, dungeon, lockstep,
  hash, replay, fixture or score change). Playable while loading (revision 2, owner): every renderer draws its
  placeholder (a stand-in) until the logical id's content has downloaded on this device, then swaps live. Pure core in
  shared/view: `ArtReadiness` (content id pending / ready / failed, one retry after `ART_READINESS.retryAfterSec`, a
  final failure stays a stand-in; logical id ready when every content id is ready, none = ready; `epoch` /
  `flippedSince`: flips in either direction), `standIns.ts` (`drawsArt`, `FlipTracker`, `ReadyIds`),
  `pieceStandIns.ts` (`ReadinessCursor`, `lookWhenReady`, the solid decor stand-in boxes `SOLID_DECOR_STAND_IN`: a box
  over every solid decor piece whose art is missing or not ready, so no blocker is invisible), the stage manifest
  (`stageGroups.ts` / `stageAssets.ts` / `STAGE_ASSETS`: characters, bullets, actor kinds with runtime children, biome,
  features, run kit, audio, in front-lane order; coverage spec over the vale pack), `stageAudit.ts`; shared/run
  `stageInput.ts` (`stageInputOf`, `forecastStageInput` with no generation, `forecastFirstFloor`, `biomeIndexOf`).
  `PreloadQueue` lanes front / next / back, `LoadWaiters` progress, `PRELOAD.chunkSizeByDevice`; `PRELOAD.core` is the
  menu kit (`ui.`, `sfx.ui.`, menu / lobby music, front lane). PreloadController owns the readiness
  (`getReadiness` / `isArtReady` / `onReadinessChanged`; `GetAssetFetchStatus` pre-check under pcall). StageController:
  each cover pushes the floor's manifest to the front lane; a solo run start waits at most
  `STAGE_ASSETS.wait.softWaitSec` 1.5 s (bar after 0.4 s), floor changes and co-op never wait (`assetCapSec` gone);
  floor n + 1 prefetched to `next` at each reveal, the first floor's guess on the menu / in a lobby, today's Daily's
  own floor 1 (`forecastDailyFirstFloor` from the daily slice's seed) at the head of `next` ahead of it
  (`PreloadQueue.push(..., first)`, 2026-11-11). AudioController
  drops a cue not loaded (never late) and fades a bed in when it lands (`BedGate`, `AUDIO_VIEW.lateBedFadeSec`). UI:
  `client/ui` `uiImage` / `UI_IMAGES` / `useUiArt` (`UiArtController`), the flat UI until an image is in. Debug
  (`RUN_ATTRIBUTES`): `KV_StandInsForce` ("all" or prefixes), `KV_FakeAssetLatency` (Studio), `KV_StageAssetAudit`.
  No new strings, roles or sounds; no Luau-locals change. Studio checks, SA0 / SA20 device measurements and the
  playtest pending; SA9 warm draw and SA12 telemetry not built.
- **The Archer (docs/ARCHER.md, 2026-11-09).** Gameplay plus a client screen, server fields and art. Two characters,
  `shared/characters` (`CharacterId` knight / archer, `CHARACTERS`, `DEFAULT_CHARACTER` knight; theme slots
  `class.vanguard` "Knight" and `class.ranger` "Archer", ARD1): a character is a loadout (Knight `[weapon.sword]`, Archer
  `[weapon.bow]`; set 1 empty) plus `PlayerTraits` (`SimConfig.traits` / `PartyConfig.traits[i]`, unhashed config like
  the loadout's source; Archer `rollDashPercent` 140: 2.5 -> 3.38 tiles, `rollIframePercent` 125 folded with Slippery
  into one `scaleTicks`). The sim never imports `shared/characters`. A SWAP onto an empty set does nothing. Boons /
  relics carry `requires` (Piercing Arrows, Ballista: bow; Riposte, Mirror Cloak: sword); every pool (`drawCardOffers`,
  `drawBoonOffers`, `legendaryPool` / `drawLegendaryOffers`, `classicLegendaryPool`, `unownedRelics`) takes the
  player's eligibility mask, derived from their hashed weapons; duos follow their boons; a two-weapon player draws
  exactly as before (rng included). Run configs: `WorldBuildOptions.characters` / `RunSetup.characters` (endless,
  daily, dev; dev "Both weapons"); M1 `game` / `dungeonNoEncounter` / `greybox` and every fixture keep
  `DEFAULT_LOADOUT` and no traits, so every golden fixture matches; endless / daily / dev / tutorial replays and scores
  changed (boards stay `_v1`, `DAILY.ruleset` 13 -> 14). Server: `StartRunRequest.characterId` (replaces `classId`),
  `Lobby.characters` with the Ready, `RunSession.characters`, `PartyRunStart.characters`, `RunSubmission.characterId`,
  leaderboard `classId` = each member's character, telemetry fields. Tutorial: the Knight's, combat E removed (10
  rooms, floor-1 seed 7574 -> 7511, the `cover` placement and the `bow` step gone, funnel revision 4 `t1r4`, caps 84 /
  252). Client: the character screen (`MenuScreen` `character`) before every run started from the menu, the tutorial
  outro, the dev panel and a lobby Ready; Again keeps the run's character, the run-over Character button changes it;
  the pick persists as `DisplaySettings.character` (only non-Knight stored, doc stays v2). View: per-player visuals,
  swap prompts only with a swap target (`hasSwapTarget`), character icons, per-character text overrides
  `<key>.<characterId>`. Art: the SmallScaleInt Archer (paid edition, Standard Commercial License), sprite set
  `class.ranger` built by `build-atlases.js --only class.ranger`; its 14 PNGs uploaded 2026-11-09 (`assetIds.ts`), so the
  bundled vale pack draws the Archer. Tuning measured (AR13; census `npm run test:only -- --census run/archer.survival`);
  owner calls and the Studio check (AR14) pending. Health (owner answer 12): `PlayerTraits.heartsMaxDelta` (half hearts,
  neutral 0), the Archer's `ARCHER_HEARTS_MAX_DELTA` -2 = 2 hearts to the Knight's 3, applied in `createSimState` per
  player (`playerStartHalfHearts`, at least 1); `runStartHalfHearts` takes a player index. Archer replays changed;
  Knight runs, M1, every fixture and the tutorial unchanged.
- **Rollback spike (docs/ROLLBACK_SPIKE.md, 2026-11-09): don't build rollback; the spike code is removed.**
  Measured whether co-op rollback is worth building (copy the state, step it H ticks a frame with guessed teammate
  inputs, in a Parallel Luau worker that mirrors the run). Results: H 16 cost 4.06 ms p95 a frame on the owner's Mac on
  dev floor 15 but 11.77 ms on an iPhone 17 (50 fps); the bot sweep's teammate corrections >= 1 tile ran 27-74 a minute
  at L 6-16 against a gate of 6. Decision RBD8 (owner): build docs/LOCAL_PREDICTION.md instead, with its enemy bullets
  drawn ahead (the spike's "cheap plan", LP10). R7 removed every part (the probe, worker, capture service, debug remote
  `rollbackProbe`, the `KV_Rollback*` switches, the analytics events `RollbackCpu` / `RollbackProbe`, the plugin and
  receiver, the `LockstepClient` accessors, `recordNoisyPartyRun`); `shared/run/testing` `denseFight.ts` (the replay
  bench's setup) and the Lune runner's `--flag name` stay. The last commit with the code is `f6f6e6c`
  (`git show f6f6e6c:<path>`); the doc keeps the plan, as built and results as the record.
- **Local prediction (docs/LOCAL_PREDICTION.md).** Presentation and client timing only (no sim, dungeon, hash, replay,
  wire, fixture or score change; the sim still steps exactly the merged log, and nothing predicted reaches it, a hash, a
  recording or a remote; solo runs are untouched). In co-op the local player's BODY is drawn ahead of the merged state
  (LPD3): position, facing, the roll, the walk's speed, the flask / weapon slowdowns and the sword's lunge, replayed
  from the inputs the client sent (the server's queued frames first, then `sent`, a tick never sent repeating the last).
  shared/lockstep `predictMotion.ts` (`copyMotionBase` / `predictMotionTick`) is a MIRROR of `stepPlayer`'s motion and
  `stepWeapons`' motion counters (guard, wind-up, lunge, bow charge, swaps, Quickstep / Frenzy timers), never a sim
  refactor (LPD1): `predictMotion.spec.ts` pins it bit for bit to the real sim, so **any sim change to the player's
  motion or a weapon's `moveMultiplier` must update the mirror and keep that parity spec passing**. `LocalPredictor`
  (`predict.ts`) rebuilds the head after every pump that stepped, through `LockstepTunables.prediction`
  (`DEFAULT_LOCKSTEP.prediction` = `PREDICTION`; undefined = off, as the exact-stepping network specs pass):
  `predicted()` / `predictedPath()` / `predictionHorizonTicks()` / `predictionStats()`. The horizon is the effective
  lead capped at `PREDICTION.maxTicks` 20 (333 ms; LPD4, owner, 10 until 2026-11-10). shared/view/predict:
  `PredictionSmoother` (`PREDICTION_VIEW`: half-life 0.06 s, snaps over 1 tile and on run start, floor change, spectate
  switch) and `writeDrawnPlayer`; SimController `getDrawnPlayer` (the local player as drawn while predicting, else
  exactly `playerAt`) feeds the knight, camera (LPD8), weapon view, aura, minimap self marker, occlusion fade, cue
  mapper and the aim origin; attacks, hits, hearts, the i-frame look (LPD5), pickups, teammates and enemies stay merged,
  and no hitbox pip is drawn (LPD7). LP10: `BulletAhead` draws each enemy bullet `getPredictionAheadTicks()` ticks ahead
  in closed form (the Hourglass per tick, life, walls and intact pieces; goo and strikes unchanged;
  `BULLET_AHEAD.maxTicks` 30). Debug: `KV_PredictOff` (`RUN_ATTRIBUTES.predictOff`, read at each co-op start) builds the
  client without prediction; the KV_Debug co-op line's `{pred}` part (`hud.debug.pred` / `.predWait` / `.predOff`, press
  -> drawn) and `KV_CollisionDebug`'s merged ring. LP8 signed off by the owner in a Studio test on a simulated 4G link
  (2026-11-10); the group / phone playtest stays optional.

- **Gauntlet cursor (docs/CURSOR.md).** Presentation only (no sim, dungeon, lockstep, server, hash, replay, fixture or
  score change). The Lords of Pain gauntlet (white; yellow over a button) is a software cursor in a menu context only
  (client/store `selectCursorMenuContext` = `selectMenuOpen` or the local draft open in a running run: menus, panels,
  the loading screen and stage cover, pause, the party overlay, the draft, run over, the tutorial outro); gameplay keeps
  the Roblox pointer, so aiming is untouched. `CursorController` (ScreenGui `KV_Cursor`, display order 200, a `Last`
  render step) is the single writer of `UserInputService.MouseIconEnabled` (= mode `system`, the label's Visible = mode
  `custom`, written in the same step); `MouseIconController` (the pointer hidden on a gamepad) is folded in and
  deleted. Pure core shared/view `cursorMode` / `cursorVisualId` / `cursorScale` / `cursorSqueeze` / `cursorPlacement`
  (`CURSOR_VIEW`); the hover test is `PlayerGui:GetGuiObjectsAtPosition` at 20 Hz in a menu context (its inset
  convention is C0's open question); the click squeeze is off under reduced motion. Theme: shared/theme `cursorArt(pack)`
  (undefined while `ui.cursor` is a placeholder: the system pointer), an optional port id `ui.cursor.hover` (same size
  and pivot, `cursorArtProblems`); the gauntlet waits for its art readiness. Art pipeline: an image `pivot` may be
  `{ x, y }` in source pixels (fingertip (53, 54) -> (4, 4)), `sameCropAs` fails a variant that crops differently,
  `--only <images id>` builds one image's family. Setting `DisplaySettings.cursorSize` Small / Normal / Large (whole
  scale steps; overrides-only, doc stays v2), the Options > Display row shown only with a mouse and the art, strings
  `options.display.cursorSize*`. Kill switch `KV_SystemCursor` (`RUN_ATTRIBUTES.systemCursor`, read live). `ui-cursor.png`
  / `ui-cursor-hover.png` uploaded 2026-11-11 (`assetIds.ts`), so the bundled vale pack draws the gauntlet; the Studio
  answers (C0) and the smoke test (C8) pending.

- **Floor modifiers (docs/FLOOR_MODIFIERS.md).** Gameplay (dungeon), endless only, floor-built: opt-in
  `EndlessFloorOptions.modifiers` (a `FloorModifierWorld`: the world's golden / pellets / breakable loot / affixes, plus
  `vaults`), set by shared/run `endlessRunFloor` (`ENDLESS_MODIFIER_WORLD`, all on) for endless solo / co-op, the Daily,
  dev and the server's registry and validator. shared/dungeon `modifiers.ts` / `modifiersData.ts`: its own stream
  (`floorSeed ^ MODIFIERS.salt` 0x4b56464d), from floor 2 ONE chance draw (20 / 25 / 30 % by band), never on a boss
  floor, never on the floor after a chance hit (floor n - 1's draw alone, no build), then ONE weighted kind draw
  (Gilded 1 / Hoard 1 / Feast 2 / Plunder 2 / Blood Moon 2) giving a start index; the first eligible kind in table order
  wins (none: no modifier). Honesty (FMD3 / FMD7): eligibility reads the floor built without modifiers, so a kind lands
  only where its effect is certain and new. Each kind re-runs one existing placer with a force flag, then every placer
  after it (`buildEndlessFloor`'s `placeFloorParts`; a forced roll still makes its chance draw): Gilded `placeGolden`
  `certain`, Hoard `placeVault` `every`, Feast `placePellets` `powerCertain`, Plunder `placeBreakableLoot` `everyRoom`
  (one loaded piece in every room with a weighted piece, >= 3 such rooms), the twist Blood Moon `assignAffixes`
  `sharePercent` 200 (elite rooms 35 -> 70 %, combat rooms' chance 10 -> 20 %, >= 2 more affixed members). No sim state,
  rule or hash group: the forced outputs reach the sim through their own groups; `EndlessFloorLayout.modifier` (NONE when
  off, plain or a tutorial floor) and the optional, view-only `EndlessFloorWorld.modifier`. Option off or a plain floor:
  every output as before (`roomPool.lock.spec`). M1, every fixture and the tutorial replay as before; endless / daily /
  dev replays and scores change on modifier floors (the stormcaller co-op pin and sim golden.spec's scene finder moved),
  boards stay `_v1`, `DAILY.ruleset` 15 -> 16. Dev:
  `KV_FloorModifier` (`parseFloorModifierOverride` -> `FloorModifierOverride`: the kind on every floor where eligible,
  ignoring the chance, the streak and the boss rule; dev world only). Theme: strings `floormod.<key>.name` / `.line` and
  `hud.pause.floorMod`, roles `floorMod.<key>` (the boons reuse the Goldling / Legendary vault / power pellet / Frenzy
  hexes, Blood Moon a new crimson `#ff3348`; `floorModifierReport`), five port audio IDs `sfx.floor.modifier.<key>`
  (lowercase, `.bloodmoon`; SILENT, fallbacks `sfx.jingle.treasure` / `sfx.horde.horn`, priority 67 under the floor
  enter), optional icon ids `ui.floormod.<key>`; `contract.luau` / `validate.luau` 186 / 192 top-level locals (counted
  on out/, unchanged). Client: shared/view/modifiers (`FLOOR_MODIFIER_VIEW`, `ModifierPayoff`); the floor card's banner
  (stamped 0.3 s after the card, the card held 1.8 s while the draft freezes the world, none with a live world, where
  the banner may not show; on the run-start cover in a dev run past floor 1; the sting silent until its clips exist),
  `FloorModifierChip` (`RunInfo.floorModifier`; status corner beside `HordeChip`, touch strip; one pulse when the
  promise pays off), the pause line (`hud.pause.floorMod`). FM9 census (runs 1-60 x floors 2-30, solo = party 3):
  21.5 % of non-boss floors, mix Gilded 9 / Hoard 7 / Feast 23 / Plunder 38 / Blood Moon 23 %, Plunder 11.1 loaded
  pieces per floor vs 1.8 natural, Blood Moon x1.9 affixed members. Pending: owner calls OC1-OC3 (more twists, Plunder's
  strength, the mix), the stings (FM10), icons (FM11), Studio check and playtest (FM12), telemetry (FM13).
- **Goldling hiding places and rumours (docs/GOLDLING_RUMOURS.md, 2026-11-12).** Gameplay for the Goldling only
  (opt-in `SimConfig.golden`, endless / co-op / daily / dev), plus presentation. Supersedes docs/FORTUNE.md FD10's "3 s
  after its room engages" (RD10): shared/dungeon `placeGolden` (still last, its own stream, 0 / 1 / 4 draws: chance,
  room, cell, kind) also places the Goldling's own barrel or crate in its room (a `breakableCandidates` cell passing
  `pieceFitter` against every piece, the vault's chest included, off pellet cells and the chest's front box; a room
  needs one to be eligible, tested before the room draw), `FloorGolden.piece` / `pieceX` / `pieceY` / `pieceKind`,
  `GoldenFloorInput` gains `pieces` / `pellets` / `vault`; `buildEndlessFloor` appends it after every other piece
  (after the chest), so every earlier output and slot is unchanged and only `roomSpawnTiles` loses its cell; it never
  holds loot (RD15). GR1 census: Goldling floors per band unchanged, none lost (296 of 760, runs 1-40 x floors 2-20).
  Sim: WAITING until a PLAYER breaks it (`damageBreakable` refuses `ENEMY_BULLET` / `SLAM` on that slot like the
  chest's, `goldenGuardsPiece`: bullets stop on it, a Charger stuns, Bombers and slams leave it; RD13); a player's break
  calls the leaf hook `goldenOnBreak` (`releaseTick`), `stepGolden` spawns it at the piece's cell centre that tick (a
  full pool: SKIPPED); never found: hidden until the floor ends (RD12); `engageTick` still latches; running, catch,
  escape and payouts unchanged (RD8). `GoldenConfig.appearTicks`, `GOLDEN_APPEAR_TICKS`, `goldenSpawnTile` and the
  freeze's waiting branch (`holdAbsoluteTimers`) are gone; new `goldenPieceAt` / `goldenPieceCentre`. Hash: `releaseTick`
  / `piece` appended at the end of the `golden` group (`GOLDEN_HASH_TAIL_FIELDS`). M1, every fixture and the tutorial
  replay exactly as before; endless replays and scores changed (the charger run 4 floor 3 and stormcaller run 4 / run 23
  floor 3 pins re-recorded, only where a Goldling piece now stands), the all-time boards stay `_v1`, `DAILY.ruleset`
  17 -> 18. Presentation: the piece glints like a loot piece while it hides (shared/view `pieceGlints`, RD14); the coin
  flash / `GOLDLING!` wait `afterBreakSec` 0.12 s after the break (`GoldenAppearQueue`); the per-client
  `GoldenRumourClock` (shared/view/golden rumour.ts, phases NONE / FLOOR / ROOM, owned by SimController): the floor
  rumour once per floor 1 s into unfrozen FLOOR time, the room rumour on its room's engagement (RD3 / RD5); port audio
  IDs `sfx.golden.rumour.floor` / `.room` (SILENT in the placeholder, falling back to `sfx.score.tick`; priorities 45 /
  66; from outside the room at teammate volume, RD6); `GoldenRumourChip` beside the Horde chip (`hud.chip.golden.rumour` /
  `.hiding`, snapshot `goldenRumour`, StatusPanel `ChipBoostRow` and the touch strip, RD4); first-time card (sighting id
  `golden.rumour`, `bestiary.golden.rumour`, RD7); `KV_GoldenLabel`'s WAITING line. `contract.luau` / `validate.luau`
  186 / 192 top-level locals (counted on out/). GR8 hunt census (`run/goldenCensus.spec.ts`, `--census`; its bow rows
  now the Archer's): solo sword 17 / 18 focused and during the fight, 18 / 18 after the clear (it comes out within sword
  reach; GE4: 15 / 18 and 6 / 18), Archer bow 6 / 18 focused and 7 / 18 after the clear (the stream's 5 hp / s caps it past floor 2), party of 2 16 / 18 (every sword miss SKIPPED on a full
  pool). The rumour clips auditioned and uploaded 2026-11-14 (GR10; vale plays them). Pending: RD3-RD7 / RD9
  confirmation, the Studio check and playtest (GR11),
  telemetry (GR12, optional) and docs/FORTUNE.md's open calls 2 / 3 with the GR8 numbers.

- **Codex (docs/CODEX.md).** Presentation plus one server doc (no sim, dungeon, lockstep, hash, replay, fixture or score
  change; drafts and their odds untouched). `CODEX_CATALOG` (shared/codex, 86 entries, ids `<category>:<key>` from the
  theme ids, append-only order lock in `catalog.spec`), two tiers seen / found. DataStore `KV_Codex_v1` (`CodexService`;
  `{ v: 1, seeded?, e: { [id]: [tier, day, floor] }, unread? }`), every write a `MergeKeyValue` UpdateAsync (tiers only
  rise, the earliest found day wins), seeded once from the onboarding doc's cached `seen` without NEW dots
  (`OnboardingService.joinLoadState`; a failed load = `loaded: false`, never written). Remotes `codexStatus` (push after
  the join load and seed) / `requestCodex` / `codexClaim` (<= 16 items) / `codexViewed` (<= 64 ids), 10 / 10 s each.
  **Client-trusted claims (CXD1, owner):** the server checks id / tier / size / rate and replays nothing; claims only
  from endless / the Daily (with toasts) and the tutorial (silent), never M1, `dev`, dev / stress runs or a run started
  with `KV_Debug` on (`SimController.isDebugRun()`). Client: pure `CodexTracker` / `readCodexFrame` (shared/view/codex)
  run inside `SimController.pushToasts` (`ToastChipSource`, `ToastView.codexNew`; FX kills land one frame late),
  `CodexOutbox` (queue until loaded, batch, pace), `CodexController`, store slice `codex`, `CodexScreen` (MenuScreen
  `codex`, button after Leaderboard with `MenuButton.badge`), draft `NEW` tags after the flip, RunOverPanel
  `ROW.codex` (compact stats gap 6 -> 2 only while the row shows; the row drops icons, then wraps, to fit). Strings
  `CODEX_STRING_KEYS` (54, spread last into `REQUIRED_STRING_KEYS`, after the floor modifiers' and the Goldling
  rumours'; `sfx.codex.new` last in `PORT_AUDIO_EVENTS`, after their stings and rumours: a later feature appending there
  must update `codex.spec`'s tail and the skips in the fortune / treasure / runRecap / boosts / audio / contract /
  floorModifiers specs); port audio id `sfx.codex.new` SILENT, no fallback, `SFX_PRIORITY` 46; the rumours' first-time
  card (sighting id `golden.rumour`) is no entry (the seed drops it, its card never wears the chip);
  `contract.luau` / `validate.luau` top-level locals now 187 / 197 (counted on out/). Debug `KV_FakeCodex` (Studio:
  `all` / `seen` / `none` / `unknown` / an id list). No setting. Studio check and the sound's audition / lock / build /
  upload (CX11) pending.
- **Haptics in play (docs/HAPTICS.md, 2026-11-13).** Presentation only (no sim, dungeon, lockstep, hash, replay,
  fixture, score or wire change; no new sim field: kills are credited from existing feeds, HPD1). Five moments vibrate
  on the view player's own events: kill (one tick a frame, `killGapSec` 0.07, `killCapPerSec` 6), parry (per guard,
  big from `NEAR_MISS_VIEW.parry.bigFrom`), the boss phase break (HPD4: "stagger") and death (HPD5) for everyone in
  the fight, hurt per `StateWatch.hurtKind` (HPD9); priority lethal > boss death > stagger > heart > armor > parry >
  kill, a weaker cue never cuts a stronger one; only kills drop for the gap / cap / 40 % duty cap (HPD10). Pure core in
  shared/view/fx (`haptics.ts`: the pulse types, ramped `hapticTimeline` and `HapticGenerations` with a priority, moved
  out of shared/view/menu padFeedback.ts, which re-exports them, `MENU_HAPTICS` keeping `delaySec`; `hapticsConfig.ts`
  `PLAY_HAPTICS` / `PLAY_HAPTICS_PRIORITY` / `PLAY_HAPTICS_RULES` / `HAPTIC_DEBUG`; `playHaptics.ts`
  `PlayHapticsDirector`, `touchWaveform`; `playHapticsInput.ts` the facts -> input builder). **`HapticsController`
  (client/controllers/fx) replaces `PadHapticsController`** (client/controllers/ui, removed; FocusController injects
  the new one): menu cues as before, play cues in a new `FX_FRAME_PHASE.haptics` (1, after `normal`) on the pad that
  drives the player (new `InputController.getActivePad`) or, on a phone, nine `HapticEffect`s made on first use under
  `Workspace/KV_Haptics` (Custom, `SetWaveformKeys` once; any failure disables the backend for the session). Kill feed:
  scored runs the run view's `RecapTally` (`ScoreEvents.popPlayer`), unscored solo every tracker kill, unscored co-op
  M1 none; a heavy kill in co-op only when every kill of the frame is the view player's. Quiet in menus, paused, the
  draft, under the stage cover, spectating (HPD7) and after run over, except the run-ending frame's lethal hit or boss
  death (`PlayHapticsInput.ending`). Setting: new **`DisplaySettings.touchVibration`** (default On, only Off stored,
  settings doc stays v2, kept by the Display reset) on a new Options > Controls > **Touch** sub-tab (touch devices only;
  string `options.device.touch`; no pad X Reset there, `PadCondition` `canReset`; opens there for a touch player);
  `padVibration` now covers menus and play (HPD6); reduced motion changes nothing (HPD8). Debug `KV_HapticDebug`
  (prints, test cues 1-7). HP0 (the device spike, docs/SPIKES.md) and HP8 (device check + tune) pending.

- **Secret rooms (docs/SECRET_ROOMS.md).** Gameplay, opt-in `SimConfig.secrets` (`SECRETS_CONFIG`; endless solo / co-op,
  the Daily, dev, the server's registry and validator through `buildEndlessRunConfig`; never M1 or the tutorial).
  Floor-built: shared/dungeon `placeSecret` (`secrets.ts` / `secretsData.ts`, its own stream `floorSeed ^ SECRET.salt`
  0x4b565343, 0 / 1 / 3 draws: chance 25 % from floor 2 (no bands, boss floors allowed, never the boss room), one
  uniform pick over every candidate, the chest's tier Rare 65 / Legendary 35) runs LAST in `buildEndlessFloor`
  (`EndlessFloorOptions.secrets`, dev `secretOverride`): a 2-cell crack on an outer far wall of a combat / elite room
  with VOID behind, a 3-deep front box, a 5x4 / 4x4 / 4x3 / 3x3 chamber dug into the void with a clear halo, the chest
  on its back row facing the crack; census 21.6 % of floors (runs 1-60 x floors 2-30). The crack's pieces (kind
  `crackedWall`, `BREAKABLE_PIECE_KINDS` index 3) then the chest are appended after every other piece, so no earlier
  output, digest or slot moves; `EndlessFloorLayout` / `EndlessFloorWorld.secret` (`FloorSecret`) carries the carved
  `dungeon` (a new `grid`: chamber FLOOR, ring WALL, crack FLOOR under its pieces; `bfs` / stats the Forge's), which
  only the sim's five movers / blockers use (`endlessFloorWorld`); every view draws the Forge grid until the open.
  Sim: `BreakableKind.CRACKED_WALL` 3, inert like the chest (`inertPiece(kind)` replaces every chest test, kinds 0-2
  byte-identical); every contact that reaches `damageBreakable` is an unhashed per-tick knock (`BreakablesState`
  `knockSlots` / `knockSources` / `knockPlayers`). Four openers (`sim/secrets/open.ts`): the sword's finisher (a trailing
  `finisher` flag on `sweepArc` / `meleeHitBreakables`, swings 1 and 2 knock), a Wrecker roll (`rollSmashBreakables`),
  a heavy arrow stopped by a piece or a Siege slam (`secretsSlamAt`), a Charger's charge tick (`secretsChargeAt`,
  before `slamBreakables`); the open breaks every crack piece that tick with no breakables bookkeeping and pays
  `ScoreSource.SECRET` 16 (600 x the kills' floor scale, combo-neutral; `addSecretScoreSources` padded last: every
  endless run holds 17 sources). The chest opens on reach with the vault's grants, lifted unchanged into
  `sim/treasure/grants.ts` (`grantShares`, the vault's draws and pins untouched), from the secrets' own rng word
  (`seedToState(seed) ^ 0x4b565352`); its treasure points into SECRET. `state.secrets` hashed as the `secrets` group
  appended LAST (after `golden`); events `opened` / `taken` per tick, `secretsRunSummary`. M1, every golden fixture and
  the tutorial replay exactly as before; endless / daily / dev replays and scores changed (boards stay `_v1`),
  `DAILY.ruleset` 18 -> 19; pins re-recorded only where a secret now stands (`sim/charger.spec` PIN_HASH e42f7fdf ->
  b44f15ea, `sim/stormcaller.spec` run 4 floor 3 0406aa34 -> 6b926521); `run/stageInput.ts` counts clutter as
  `BREAKABLE_KINDS`. Theme (`shared/theme/secrets.ts`): strings `SECRET_STRING_KEYS` (SECRET!, `Secret found by
  {name}`, `Secret cache`, `Secrets found`, the Codex name) written out last in `REQUIRED_STRING_KEYS`, the first-knock
  card `bestiary.secret.crack` (sighting `secret.crack`, SIGHTING_IDS' last) with the Archer's override
  `bestiary.secret.crack.archer`, `score.source.secret`; port audio IDs `sfx.secret.knock` / `.open` /
  `sfx.jingle.secret` after `sfx.codex.new` (SILENT in both packs, `SFX_FALLBACK` to the breakable hit / break and the
  treasure jingle; codex.spec's tail and the listed specs' skips updated: a later feature appending there must update
  them again); role `secret.dust` `#c8bfae` (`secretReport`); optional world art `secret.crack` / `secret.rubble` (slot
  `secret`, one facing) and fx `fx.secret.dust`: original art by `scripts/art/gen-secret-art.js` in its own sheet
  `secret.png` (`--only secret`, `packs/vale/secretLayout.ts`), uploaded 2026-11-13; stage feature `secret`. Codex: entry
  `secret:room` (group `secrets`, the Bestiary tab's last section; catalogue 86 -> 87, order lock updated), seen at the
  local player's first knock, found at an open. `contract.luau` / `validate.luau` top-level locals 187 / 197 (counted
  on out/, unchanged). View (presentation only): shared/view/secrets (`SECRET_VIEW`, `SecretFrameEvents` on every
  RunView as `secrets`, `secretLook` / `SecretViewTracker`, `KnockThrottle` 0.2 s, `FirstKnockLatch`, `SecretCueTracker`,
  the merge hole / chamber build / map change / news / drawn parts), `planVoid`'s hold-out (`VoidPlan.held`) and
  `planDecor`'s keep-out (both byte-identical without a secret), `FLOOR_SHOUT_PRIORITY.secret` 3.5, recap highlight
  `secrets`; client `SecretRenderController` (crack Part in the wall's look through the new `game/worldSurfaces.ts`,
  overlay or a darker band, dust, puffs, burst, the chamber built hidden and shown at the open, the chest through
  `treasureBody` with the vault's open, column and `Secret cache` cards), WorldController's crack hole,
  `VoidController.sinkHeld`, MinimapController's open / reveal / chest mark, the co-op toast (TreasureToastController),
  the first-time card (SightingController, `sightingCardKey` with the local character), the Codex claims, the recap
  input and the cue mapper's `secrets`. Debug: `KV_SecretDebug` (dev world: `every`, `legendary` / `rare`),
  `KV_SecretLabel` (`RUN_ATTRIBUTES.secretLabel`, Studio or KV_Debug: outlines and a label), the `[Secret]` line under
  KV_Debug. Pending: the sounds (SR14), the `secret.png` upload, the Studio check and playtest (SR15); the discovery
  bot census (SR13) and telemetry (SR16) optional, not built.
- **Silver (docs/SILVER.md, 2026-11-14).** Gameplay (sim config, dungeon, a hashed group), a server doc and client.
  **Heart cut:** the Knight's traits are `heartsMaxDelta` -2 (`KNIGHT_HEARTS_MAX_DELTA`; no longer `NEUTRAL_TRAITS`), the
  Archer's -3 (4 / 3 half hearts); `START_HALF_HEARTS` stays 6, so M1 (no traits) and every golden fixture replay as
  before with no setter; `TUTORIAL_START_HALF_HEARTS` 4 -> 2. Odd maxima end in a half container (`HEART_FILL` 3 / 4,
  theme `ui.heart.halfmax` / `.halfmax.empty` from `scripts/art/gen-heart-halfmax.js`, atlas group `heartIcons`, own
  sheet `heart-icons.png`, uploaded 2026-11-14). **Upgrades:** `PlayerTraits.armorMaxDelta` / `flaskChargesDelta` (neutral 0),
  shared/characters `UpgradeLevels` / `upgradeTraits`; the server reads each member's levels at the start
  (`SilverAccessService`, wired by WalletService), stores them on the session and returns them
  (`StartRunReply.upgrades`, `PartyRunStart.upgrades`); `upgradesApply`: endless and the Daily (SVD3), never M1 or the
  tutorial. **Lock:** the Archer is an Armory unlock (`locked_character`, the lobby's `lockedCharacter`; an unknown
  wallet plays the Knight only). **Crates:** shared/dungeon `placeBreakableSilver` (salt `0x4b56534c`, once, last, after
  `placeSecret`), opt-in `SimConfig.silver` (`ENDLESS_SILVER_CONFIG`, every endless / daily / dev build), `state.silver`
  hashed as the `silver` group appended LAST (after `secrets`), `silverOnBreak` after `dropsOnBreak` (any source), no rng,
  no score source. **Wallet:** DataStore `KV_Wallet_v1` (`{ v: 1, earned, spent, own, eq?, runs, runDay?, dailyDay? }`),
  every change an UpdateAsync transaction (shared/wallet `WalletBook`, server `WalletTransactions` / `WalletService`),
  the run's rows read in `SegmentedValidator.decide()` (`readSilver`, `SegmentedRunResult.silver`), grants in `conclude`
  for the credited members, day bonuses decided inside the transaction; remotes `wallet` / `requestWallet` / `walletBuy`
  / `walletEquip`; economy events and `ArmoryPurchase` (38 of 100 names). Endless, daily, dev and tutorial replays and
  scores changed (boards stay `_v1`); `DAILY.ruleset` 19 -> 20. Theme: `SILVER_STRING_KEYS` spread last into
  `REQUIRED_STRING_KEYS`, role `silver`, port audio IDs `sfx.silver.gain` / `.crate`, `sfx.shop.buy` / `.deny` last in
  `PORT_AUDIO_EVENTS` (SILENT; a later feature appending there must update codex.spec's tail and the listed skips);
  `contract.luau` / `validate.luau` top-level locals 188 / 192 (counted on out/). Debug `KV_FakeWallet` (Studio),
  `KV_SilverDebug` (dev), `KV_SilverLabel`. The four sounds picked and uploaded 2026-11-14 (vale plays them; volumes
  1 until the mix pass). Art built 2026-11-14 (presentation only): `ui.icon.silver` (an octagonal coin with a crescent)
  and `fx.silver.coins` (a looping 8-frame turn, tinted `silver`) as original pixel art by `scripts/art/gen-silver-art.js`,
  atlas group `silver` (`--only silver`, `packs/vale/silverLayout.ts`), two sheets of their own (`silver-icon.png`,
  `silver-coin.png`); `SilverHudController` draws the flipbook once downloaded, else the dots. Both sheets uploaded
  2026-11-14 (`assetIds.ts`), so the bundled vale pack draws them. Studio check and cosmetics pending.

- **Silver shop (docs/SILVER_SHOP.md, 2026-11-14).** Server, wallet doc, client and presentation only (no sim, dungeon,
  lockstep, hash, replay, fixture, score or leaderboard change; `DAILY.ruleset` unchanged). Supersedes docs/SILVER.md
  SVD1: Silver can be bought with Robux, one pool with earned Silver (SHD1), and what play pays is unchanged (SHD3).
  Wallet doc (still `v: 1`): optional `bought`, `receipts` (the last 128 granted `PurchaseId`s) and every unknown
  top-level field kept and written back (`extra`); balance = earned + bought - spent; `earned` still means play.
  **Rollout (SHD7): the codec must be live on every server before any product id is configured** (an older server
  would erase `bought`). shared/wallet `shop.ts`: `SILVER_PACKS` (append-only, pouch 150 / purse 450 / chest 1,000 /
  hoard 2,500 Silver; retired packs still grant), `SILVER_PRODUCTS` (game id -> pack -> product id, empty until the
  owner creates the products), `applyPurchase` / `receiptDecision` (Processed only for a committed grant or a
  duplicate), `WalletBook.purchase` (the per-player lock, counted in `pending()`); `shopServer.ts` (the receipt plan,
  the Studio fake, the audit record). `SilverShopService`: one filtered `BindReceiptHandler` on the universe's product
  ids (fallback `ProcessReceipt`, set once only if unset), grants whether or not the buyer is still here, a `wallet`
  push with `purchase`, the IAP economy Source and `SilverShop` `granted` only while the buyer is here, a best-effort
  audit entry in `KV_Purchases_v1` (`p_<PurchaseId>`). Remotes `silverShopReport` (funnel; custom event `SilverShop`,
  39 of 100 names) and Studio-only `silverShopFakeBuy`; `WalletStatus.shopAvailable` / `fakePrices` / `purchase`.
  Prices are Roblox's (default 20 / 55 / 115 / 265 Robux, read with `GetProductInfoAsync`; never in code, SHD8). Client:
  `SilverShopController`, store slice `silverShop`, `GetSilverPanel` (MenuLayer), `SilverBalance` with a 28 x 28 `+` in
  the Armory header and on the main menu only (`scripts/check-silver-shop-entry.test.js`); the Armory's focus scope
  gained `memoryKey="armory"`; purchase toasts on negative lobby-notice ids. Theme: 12 strings `silver.shop.*`
  (`SILVER_SHOP_STRING_KEYS`, spread last into `REQUIRED_STRING_KEYS`: a later feature appending there must update the
  pinned tails again), optional `ui.icon.robux` (absent: "55 Robux"; vale: Roblox's own icon from the Studio install, made a 14 x 14 white glyph by `scripts/art/roblox/prep_robux_icon.py`, image `ui-robux.png`, uploaded 2026-11-14, so the bundled vale pack draws it), no new audio id; `contract.luau` / `validate.luau`
  top-level locals 189 / 192 (counted on out/). Debug `KV_FakeShop` (Studio: `off` or four prices). Pending: SH0
  (Studio confirmations of the receipt API and enums) and SH9 (create the products, paste their ids, checks).

- **New enemies 2 (docs/NEW_ENEMIES_2.md).** Gameplay. Four endless room archetypes and a child in band 6
  (`PORT_BAND_ENEMIES_3`, indices 19-23; no older index moves): `bulwark` (shown as the **Shieldwall**, NXD17: Warding's
  evolution keeps "Bulwark"; a front shield turning at a literal 150 deg/s that also covers allies behind it, a bash,
  guard breaks on the sword finisher / any heavy arrow / a Siege slam's shockwave, a 1.5 s stagger; a breaking hit deals
  0, NXD19), `chainhook` (a `BulletKind.HOOK` 13 bullet down a telegraphed line that latches the player it was thrown at
  and drags them through `movePlayer` from its actor step, broken by a roll / sight / its death / 3 damage, then a yank
  fan; a teammate in the line absorbs the hook, NXD22), `snatcher` (harmless: steals its room's live pellets as
  `taken` 2, swallows them as 3 so the Sweep is lost, returns them on death, credits them to the killer when killed last,
  NXD18; one per room, `needsCompany`, never in Horde's wave 2, NXD9) and `pyrekeeper` with its runtime `pyre` (lights up
  to 3 braziers, 6 a life, on validated landing cells; the pyres fire staggered aimed shots, wither at its death scoring
  30 and feeding the combo, NXD23; a lone pyre fires on the tick it lights, NXD24; never members, never affixed, drop
  ineligible). **No new hash group:** actor `v[]`, pellet `taken` 2 / 3 and transient lists rebuilt from hashed state
  (`SimCtx.guards` after stepActors). The shield is tested at the hit sites that know an origin (the player bullet walk
  before the actor walks, the sword's sweep callbacks, the Siege shockwave): every moving player bullet stops on it,
  embers pass (NXD21); sparks, Overkill, Riposte waves, smash procs and duo strikes call `damageActor` and ignore it.
  Prediction is suspended while the local player is hooked (`chainhookHolderOf`, shared/view/predict `PredictionResume`);
  `predictMotion` and its parity spec are untouched. The pyre's fireball is BulletKind.ENEMY drawn with the new `flame`
  look by its payload source; the hook its own `HOOK` look. `ENDLESS_ROOM_KINDS` appended (weights 1, caps 2 / 1 / 1 / 1,
  `fromFloor` 2 on the new rows; `ROOM_KIND_MIN_FLOOR` chainhook 2 honoured in every world, the roster's join included,
  NXD4), 14 seeded kinds, full roster on floor 14; `STAGE_ASSETS.children` pyrekeeper -> pyre. Codex 87 -> 91: the four
  appended after `secret:room` (`CODEX_FIRST_ROOM_KINDS` 11; `pyre` folds into `enemy:pyrekeeper`). `DAILY.ruleset`
  20 -> 21 (docs/SILVER.md took 20 first; merged 2026-11-14). M1, every golden fixture and the tutorial replay exactly
  as before; endless / daily / dev replays and scores changed (boards stay `_v1`); re-recorded pins: `sim/charger.spec`, `sim/stormcaller.spec`, `dungeon/roomPool.lock`,
  `roster.spec`, `view/hud/rosterLine.spec`, `run/slice.spec`, and `dungeon/secrets.spec`'s ring check relaxed for a
  diagonal cell at a wall-line end, which the placer already allowed. Theme: role `enemyGuard` (`guardReport`), five
  `ENEMY_ARCHETYPES` (vale `enemy.pyre` on the decor brazier's cells), `bullet.enemy.hook` / `.flame` (vale: their own
  sheet `bullets-2.png`, the pipeline's bullet set key `own`; `bullets.png` byte-identical), eight SILENT port audio IDs
  after Silver's (`sfx.shop.deny`; `SFX_FALLBACK`s; a later feature appending there must update codex.spec's tail and the
  listed skips), the optional enemy animation `block`, `bestiary.<id>` lines and sightings for the four. Art sets built
  (Demon Spawn 9 / Spawn 4 / Imp 6 / Spawn 1) and uploaded 2026-11-14 (27 PNGs, `assetIds.ts`); the eight sounds are
  CC0 picks (Kenney, Ninja Adventure, bart's "Chain winch sounds", rubberduck's "80 CC0 creature SFX"; notices and
  Credits), built and uploaded 2026-11-14 but not confirmed by ear; full tuning (NX12, the loosened Archer
  floor-20 gate in `sim/archer.ttk.builds`, limited to the builds that time out there) and the Studio check (NX13)
  pending; `contract.luau` / `validate.luau` /
  `sprites.luau` top-level locals 187 / 192 / 195 (counted on out/). NX11's systems pass: `sim/newEnemies2.systems.spec`,
  `run/newEnemies2.validate.spec`; NX12-lite measurements `run/newEnemies2.tuning.spec` (`--census`). Review fixes
  (2026-11-14): a sword finisher's Storm Blade counts only unblocked hits (sword.ts `finisherHits`), a Shieldwall whose
  guard broke this tick is spared by that tick's Siege shockwave from in front (`SimCtx.guardsBroken`, transient), and a
  Pyre-keeper's landing keeps clear of every living pyre, any keeper's; byte-identical without a Shieldwall or a second
  keeper.
- **New enemies 3 (docs/NEW_ENEMIES_3.md).** Gameplay. Three endless room archetypes in band 7 (`PORT_BAND_ENEMIES_4`,
  `jackal` 24, `mender` 25, `mortar` 26; no older index moves). `mortar`: keeps 6-9 (NT0: 7-11 put it off screen)
  without sight inside its own room, lobs within 10 only while its NEAREST player stands in that room (NTD3: the new
  optional `SimConfig.roomIdAt` / `SimCtx.roomIdAt`, set by `endlessFloorWorld` to the world's `roomIdAt`, so a doorway
  or corridor cell is outside; the encounter rectangle without it), a 0.35 s draw, then a ring 1.0 s at the target plus
  its last tick's motion x 36 (clamped to 3; a non-floor point, `isBodyBlocked` or an intact piece, falls back to the
  target), landing as ONE `BulletKind.STRIKE` (the Stormcaller's; no new bullet kind) and a guardable 6-bullet shrapnel
  ring (the existing port row 6 @ FULL_RING); a Mortar killed mid-flight lands it on time from its corpse (NTD5: a new
  optional `ArchetypeDef.stepCorpse`, called in stepActors' dead branch only without `stepDead`: not a reviver; no other
  archetype defines it). `mender`: picks the most wounded room enemy (never a boss, the Goldling, the dummy, a pyre or a
  Mender, NTD8: `isMenderHealTarget`) within 6 and in sight, links 24 ticks, channels up to 3 s healing 1 hp every 30
  through `healActor` (a write to the hashed `hp` only: no `damageActor`, cap bucket, score, combo, drop or proc sees
  it); a hit (even one an affix shield soaks whole), lost sight or a living player's body on the beam cuts it; one
  cooldown gates the link and its `BulletKind.CASTER` bolt. `jackal`: bought as ONE pack of three
  (`EndlessRoomKind.packOf`, NTD6; the spender skips a pack while `packOf > slots`, compares its per-slot cost, counts
  `maxPerRoom` in packs; a pack takes its own anchor and never joins the swarmers' pack), circles at 3.0-3.6, one at a
  time per target (the target locked in v7 `JACKAL_TARGET` at the wind-up, an NT4 co-op finding), winds up 21 ticks only
  from outside its target's front cone (cos 0.34, no exception for the last of a pack, NTD10), spooked back by the
  target's facing (no draw), lunges 2.8; a sword guard that sweeps it stops the lunge, staggers it 1 s and pushes ONE
  `guardX/Z/Player` entry on `ScoreEvents` (a parry for the view, recap and haptics, NTD9; no `scoreGuardCancels`,
  points, Riposte or brace count). Draws: one in each `init`, one per lob / channel end / bolt / lunge. **No new hash
  group:** actor `v[]`; unhashed feeds `events.shells` / `heals` / `healCuts` / `lunges` / `spooks`
  (`NEW_ENEMY_3_EVENT_FIELDS`, appended last) and `CombatState.healEvents`; `events.strikes` still counts a shell (the
  lightning cue reads `strikes - shells`). `ENDLESS_ROOM_KINDS` appended (weights 1, caps 2 / 1 / 1 pack, the Mender
  `needsCompany`; `ROOM_KIND_MIN_FLOOR` mender 2 in every world, NTD7), 17 seeded kinds, full roster on floor 17;
  `ENCOUNTER_COST` 2 / 2 / 1 each (every reader but the spender is per spawn: a pack is 3 in par, Horde and SWIFT).
  Codex 91 -> 94. `DAILY.ruleset` 21 -> 22. M1, every golden fixture and the tutorial replay exactly as before;
  endless / daily / dev replays and scores changed from floor 1 (boards stay `_v1`); re-pinned: `dungeon/roomPool.lock`
  (floor 1 without a roster unchanged), `roster.spec`, `roomPool.spec`, `endless.spec`, `sim/charger.spec`,
  `sim/stormcaller.spec`, `view/hud/rosterLine.spec`, `run/slice.spec` (docs/NEW_ENEMIES_3.md NT6 table). Theme: role
  `enemyHeal` `#608c00` (`healReport` in `variantColors.ts`), three `ENEMY_ARCHETYPES` (placeholders), optional enemy
  animations `crouch` / `hop`, `bestiary.<id>` lines and sightings, six SILENT port audio IDs after New enemies 2's
  (`sfx.enemy.lob` / `.shell` / `.heal` / `.healcut` / `.lunge` / `.spooked`, `SFX_FALLBACK`s; a later feature appending
  there must update codex.spec's tail and the listed skips); `contract.luau` / `validate.luau` / `sprites.luau` 189 /
  192 / 195 top-level `local` lines (189 / 197 / 195 names, counted on out/). View (presentation only): the shell told
  from lightning by its payload source in every strike reader (its own `SHELL_DECAL` disc, never the lightning art or
  scorch), a view-only arc, a dead Mortar's ring drawn on (`mortarCorpseFlying`), the heal tether / pulse / `+` marks and
  the snap, the Jackal's stagger stars (`NewEnemy3MarksController`, `RunView.newEnemies3`), cue rows. Art: Demon Spawn 6
  / Imp 10 / Demon Beast 2 (the Jackal at bodyTiles 1.2, not the knight's density) built, 20 PNGs upload pending; six
  CC0 sound picks in `art/audio.json` and the lock, not built (the owner's `audio:build`). NT11's systems pass:
  `sim/newEnemies3.systems.spec` (20), `run/newEnemies3.validate.spec` (a validated run per kind); BulletAhead
  (presentation only) now plans pieces enemy bullets break inside its window (an imp's fan through a barrel had frozen
  the trailing bullets: the NT6 failure of `view/predict/bulletAhead.spec`), and `run/testing` `legendaryTune.ts` counts
  `ScoreEvents.guardCancels`, not the guard feed (which holds Jackal parries). NT12-lite: `run/newEnemies3.tuning.spec`
  (`--census`), no retune; owner calls OC1-OC5 and NT6's party-4 packs (P1-P4) open; Studio check (NT13) pending.

- **Cosmetics (docs/COSMETICS.md, 2026-11-17).** Presentation, wallet catalogue, server session / lobby fields and two
  network fields (no sim, dungeon, lockstep, hash, replay, fixture, score or leaderboard change; `DAILY.ruleset`
  unchanged). Pipeline: a sprite set may carry `dye` (`rule`, `unless`, `open`, `minAreaPx`, `normalizePercentile`,
  `exclude`; docs/ART.md "Dye sheets"): `<sheet>-dye.png`, same size and cell grid, the dyed region as normalised grey
  (alpha kept, else transparent), `dyeFile` per sheet and `dyeMeanValue` / `dyeSourceMean` per set in the generated
  layout; body and outline sheets byte-identical. Knight plate (sat < 0.10, lum >= 88, swing smears excluded) and Archer
  leathers (lum <= 69, browns; the bow and sword cut by a 3 x 3 opening): 15 dye sheets, built and uploaded 2026-11-17
  (`assetIds.ts`), so the bundled vale pack draws dyes. Theme: `SpriteSheetImage.dyeAssetId` /
  `SpriteFrame.dyeImage`; `contentIds()` never lists dye sheets (`dyeContentIds(setId)` does: only a worn dye joins a
  floor's stage manifest, `StageAssetInput.dyed`); `cosmetics.ts` (colours, Prismatic stops, `prismaticColor`) and
  `cosmeticReport.ts` (own module: a cycle through contract.ts): dyed mean >= 40 CIE76 from the danger roles, >= 30 from
  boosts and the Goldling, floor contrast >= min(3 : 1, the undyed region's own contrast); outline / trail / spark
  colours on the outline / danger / near-miss rules. `contract.luau` / `validate.luau` 190 / 192 top-level locals.
  Items: `shared/cosmetics` `COSMETIC_ITEMS` (append-only, the one list; 37: 8 dyes + Prismatic per character, 8
  outlines, 6 trails, 5 sparks), appended to `ARMORY_CATALOG` as `kind: "cosmetic"` rows (tiers 2-8, 28,680 Silver);
  `nextGoals` skips cosmetics. Looks: `CosmeticLook` (item ids; `readCosmeticLook` for wire values) read from the STORED
  wallet at run start (`RunSession.looks`, `StartRunReply.look`, `PartyRunStart.looks`) and on lobbies
  (`LobbyView.looks`, re-sent on equip); never hashed or in `buildWorldSetup`. Client: SpriteView's "Dye" label (built
  on first `setDye`, dye x tint, readiness by content id, carried by afterimages), per-player outline / trail / spark
  overrides, Prismatic on the sprite clock (reduced motion holds the first stop); the Armory Cosmetics tab (slot
  groups, swatches, buy / equip / take off through `MenuActions.armoryEquip`, a turning try-on `CharacterPreview`
  shared with CharacterScreen; a trail item rolls with the in-run ghosts and a spark item attacks with the in-run parry
  burst, shared/view/menu `cosmeticAction.ts`), the lobby's dye chip. Studio `KV_FakeWallet` presets `cosmetics` / `dressed`. Pending:
  the owner's sign-off on the masks (CS1) and on rule 3's revision, the device memory
  check (CS0), Studio check and playtest (CS9, CS7's two clients); earned cosmetics (CS11) and telemetry (CS12) not
  built.

- **Longer Goldling window (port retune, 2026-11-19, docs/FORTUNE.md FD17).** The Goldling escapes 15 s after it
  appears (`GOLDEN_ESCAPE_TICKS` 600 -> 900 ticks, FD10's 10 s x 1.5). Gameplay (opt-in `SimConfig.golden`): endless,
  daily and dev replays and scores change on Goldling floors (boards stay `_v1`); `DAILY.ruleset` 23 -> 24. M1, every
  golden fixture and the tutorial (no Goldling) replay exactly as before. The view's timer ring reads `escapeTicks`.

- **Boss seal off walls (2026-11-18).** Gameplay (sim, every world with a boss). The boss room's seal
  (`boss/shared.ts` `sealArena` / `sealPlayer`) clamps every player into the room's bounds, the box around its FLOOR
  tiles; on endless floors that box also holds walls (the throne's dais, candle stands, door braziers, solid pillars,
  ragged edges), so a co-op straggler pulled in from outside could land in one and stay stuck (census: every one of 90
  boss floors, 28 % of the cells within 6 tiles of the arena). Now a clamp that leaves the body overlapping a blocked
  cell (`ctx.isBodyBlocked` or an intact piece, circleOverlapsWall's test, `SEAL_OVERLAP_TOLERANCE`) puts the player on
  the centre of the nearest open cell of the arena (inside its bounds, in the room by `ctx.roomIdAt` when the world has
  it; first nearest in ring scan order; none: the room's centre tile). A clamp that lands clear, and a player already
  inside, are exactly as before, so every golden fixture matches; co-op runs where a straggler hit a wall replay
  differently. `DAILY.ruleset` 22 -> 23. Spec `run/bossSeal.spec.ts`.

## Commands

```
npm run verify      # typecheck -> lint -> build -> headless tests. Run before you finish
npm test            # gen fixtures -> rbxtsc -> Lune runs every out/shared/**/*.spec
npm run test:only -- sim/rng   # rerun specs without rebuilding; args filter by source path
npm run test:only -- --census run/archer.survival   # opt-in census specs: their full sample (docs/ARCHER.md AR13)
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
- A census too long for one file (more than about a minute) is split by run seed into shard files
  (`<name>.<n>.spec.ts`, `shared/dungeon/testing` `censusShard`), the census body in the directory's `testing/` module,
  so each shard runs in its own process (a shell that caps a command at 3 minutes) and shards can run side by side:
  the endless censuses of room edges (`view/roomEdges.endless.<n>`), minimap tiles (`view/minimap/tiles.endless.<n>`),
  elite affixes (`dungeon/affixes.census.<n>`) and snags (`run/snagCensus.<n>`). A gate that holds per shard holds over
  the whole sample; share gates are checked per shard (the affix shares have the margin at 15 run seeds).

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
