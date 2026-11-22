# Roblox Dungeons

**Roblox Dungeons** (repo `roblox-dungeons`): a co-op top-down bullet-hell roguelike on Roblox. It began as a port
of a private TypeScript web build (M1 "First fight") and has grown past it.
**roblox-ts + Flamework + Reflex + React**, synced with Rojo. The plan is `PLAN.md`; work it task by task.

## The source project

The game began as a port of a private TypeScript web build (Three.js), at its commit **`42897e2`**. That build is the
reference: its outputs are exported as golden JSON fixtures (`fixtures/`) and this build must match them bit for bit.
It is not part of this repository; where a checkout exists, its path on the machine is given in an untracked
`CLAUDE.local.md`.

**It is READ-ONLY.** Never modify it, commit to it, or run its build. Read its code; port from it.
Record every ported module in `PROVENANCE.md` (ported module, source path relative to the source project's root,
source commit).

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
| `docs/PLAYER_NAMES.md` | Co-op name tags (each living teammate's display name as a floor text just above their head, under every bullet and telegraph; below the feet by a far wall; dimmed near you and under fire; never yourself or whom you spectate; Display setting Player names): decisions PND1-PND5, as built, tasks PN1-PN4 |
| `docs/FX_AUDIO.md` | Sprite effects and audio (Ninja Adventure FX / Audio): slots, pipelines, cue mappers, tasks X0 / F0-F6 / A0-A5 |
| `docs/SPECTATE.md` | Co-op spectating (watch and switch between living teammates after a death): plan, tasks S0-S6, decisions |
| `docs/BOOSTS.md` | Temporary boosts dropped by killed enemies (Fury / Quickstep / Frenzy / Aegis): plan, tasks B0-B11, decisions |
| `docs/BOOST_ART.md` | Boost drop art (Lords of Pain gold coins and gemstones, tinted halo and beam, gems out of decor) and the boost auras (original pixel-art rings per kind and stack rank, BAD3): plan, tasks BA0-BA7, decisions |
| `docs/BREAKABLE_DROPS.md` | Boosts from breakables (some barrels / crates hold a boost, picked per floor from the floor seed, released on any break, a soft glint on loaded pieces): plan, tasks BL0-BL9, decisions BLD1-BLD9 |
| `docs/SNIPER_ART.md` | Sniper art (`enemy.sniper` as the Lords of Pain subservient): mapping, budget, tasks SN1-SN8, decisions D1-D6 |
| `docs/BOSS_DEMONLORD.md` | Demon Lord boss variant (`boss.demonlord`, seeded pick per endless boss floor, Lords of Pain Demonlord art): plan, tasks D0-D8, decisions |
| `docs/CURSOR.md` | Gauntlet mouse cursor (Lords of Pain `cursor_gauntlet_*`, software cursor in menus and run overlays; revision 3: in gameplay too unless Options > Display > In-game cursor is Standard; hover colour, Cursor size setting): plan, tasks C0-C8, decisions D1-D5, revision 3 |
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
| `docs/SHOP_ANALYTICS.md` | Shop analytics (one custom event `Purchase` for everything bought: field01 the kind upgrade / unlock / cosmetic / silverPack, field02 the currency silver / robux, field03 the item, value 1; logged by the server beside `ArmoryPurchase`, the Silver shop's `granted` and each game-pass grant, which logged nothing before; the older events unchanged; server telemetry only): the event, which chart answers what, tasks PU0-PU9, decisions PUD1-PUD7 |
| `docs/SWORD_SPACING.md` | Sword spacing (the Knight's walk while attacking and the finisher's lunge stop at a contact enemy's keep distance, contact range + 0.15, with a stop cone for keys; every world, M1 included; the Archer untouched; gameplay): findings, plan, as built, contact-hit census, tasks SP0-SP9, decisions SPD1-SPD8 |
| `docs/CODEBASE_SCALE.md` | Codebase scale (tooling only: a top-level locals budget `check:locals`, determinism lint on sim / dungeon, theme specs that check runs not positions (`runOf`), `contract.ts` / `validate.ts` / `view/sprites.ts` split into directories, the decision log in `docs/DECISIONS.md`, generated `docs/FACTS.md` and `docs/OPEN_TASKS.md`): findings, plan, as built, tasks DX1-DX11, decisions DXD1-DXD6 |
| `docs/DOC_COMMENTS.md` | Doc comments and the API reference (the comment standard: a `/** */` on every export, prose first, `@module` on file headers, fields too in `shared/sim` / `dungeon` / `lockstep`; TypeDoc -> `build/api`, one page per source file; `docs:check` and the `check:docs` ratchet in verify; `out:digest` proves a commit is comment only; tooling and comments only): findings, plan, as built, tasks DC0-DC11, decisions DCD1-DCD10 |
| `docs/REPO_HYGIENE.md` | Repo hygiene (session outputs, backups and marketing renders out of the tree, 124 branches and 24 worktree folders cleared, `.mailmap`, shared ignore rules; the history rewrite with `git filter-repo` before any remote is the owner's; tooling and repository state only): findings, as built RH0-RH8, tasks RH0-RH12, decisions RHD1-RHD8 |
| `docs/DEVELOPING.md` | Contributor guide (setup, what works without the art packs, every npm script by group, the source layout); the root `README.md` is the project overview for a reader evaluating the code |
| `docs/CI.md` | CI on GitHub Actions (the `verify` stages `verify:static` / `verify:build` / `verify:specs` in three jobs; the spec suite in 12 shards by path hash, `--shard i/n`, on x86-64 and arm64; Lune from `rokit.toml` by `scripts/ci/install-lune.sh`; the API reference to Pages; the NaN sign finding CI1; tooling only): findings, as built, tasks CI0-CI13, decisions CD1-CD9 |
| `ARCHITECTURE.md` | One-page architecture: layers and import rules, one frame of co-op, the trust boundary, the determinism invariant |
| `docs/README.md` | Index of `docs/` by group (engineering, generated, owner checklists, features, art and audio). A new doc adds its line there too |
| `docs/decisions/README.md` | Six decision records (0001-0006) extracted from the log: lockstep, runner-enforced determinism, opt-in state hashed last, rollback not built, local prediction, the wallet. Extracts; `docs/DECISIONS.md` stays the authority |
| `docs/PRESENTATION.md` | Presentation pass (server census and five rules moved to shared with specs, `SimController` and the actor renderer split, `client/log` and the print / warn lint, the `KV_*` registry, one name, private references out, architecture page, decision records, the Studio pass and task triage; no gameplay change): corrected findings, as built, findings left for the owner, tasks SE0-SE20, decisions SED1-SED11 |
| `docs/SERVER_FINDINGS.md` | Server findings (the ten findings of the presentation pass closed: the `PurchaseId` ring's bound stated in the public claims, server spikes only in Studio or a `SPIKE_TEST_PLACES` place with lines to developer-mode players, the limiter first in every remote handler with a `finishRun` limiter, wallet requests the catalogue can refuse never reaching the store or echoing the client's string, `requestRecords` dropped over budget, the client switches relabelled; no gameplay change): findings, as built, tasks SF0-SF12, decisions SFD1-SFD10 |
| `docs/SERVER_CENSUS.md` | Server census (per service the remotes and their argument checks, writes, the shared module and spec behind each rule; the five inline rules moved to shared; what is left; findings) |
| `docs/SIM_CONTROLLER.md` | `SimController` census and split (members by responsibility, clock reads, frame order, coupling; contracts, co-op / solo build, HUD feed, submissions in `client/controllers/game/sim/`, the drawn local player in `shared/view/predict`; the class keeps its path and Flamework id; refactor only): census, as built, Studio check |
| `docs/ACTOR_RENDER.md` | Actor render split (the controller as `render/actors/`: frame and actor pool in the class, `PlayerViews`, `ActorHitReact`, records and part builders, `shared/view/actorDraw.ts`; a pure move, presentation only): census, split, as built, tasks R0-R6, Studio check |
| `docs/STUDIO_PASS.md` | The owner's one ordered checklist of every open Studio, device and upload check, by session, each line naming the tasks it closes |
| `docs/OPEN_TASKS_TRIAGE.md` | Proposed state of every open task and pending log note (Studio pass, issue, done, won't do) and the `gh issue create` commands |
| `docs/DEBUG_SWITCHES.md` | Generated list of every `KV_*` name (debug switches with value / reader / gate, DataStores, instance names, render steps) from `scripts/kv-names.json` (`npm run check:kvnames -- --write`). Never edit by hand |
| `docs/DECISIONS.md` | The decision log: every deviation from `PLAN.md`, port retune and feature entry (moved out of this file) |
| `docs/FACTS.md` | Generated numbers (`npm run facts`; `facts:check` in verify): `DAILY.ruleset`, `SIM_BUTTONS`, Codex and analytics counts, theme list sizes, the archetype index table, the fullest modules' top-level locals. Never edit by hand |
| `docs/OPEN_TASKS.md` | Generated list of every plan's unchecked tasks and the decision log's pending notes (`npm run tasks:open`). Never edit by hand |

## Decisions

The decision log is `docs/DECISIONS.md` (moved out of this file 2026-11-20, docs/CODEBASE_SCALE.md): every deviation
from `PLAN.md`, port retune and feature, with what it changed and what must still replay bit for bit. **Before
changing the sim, a hash group, a world's run config, a shared theme list or a feature with its own doc, read its
entries there** (search the feature's name or doc). **After a feature or retune, add its entry there** and its row to
the table above. Generated numbers live in `docs/FACTS.md` (`npm run facts`), every plan's open tasks in
`docs/OPEN_TASKS.md` (`npm run tasks:open`).

Rules from the log that apply to every task:

- **Golden fixtures replay under the web setters.** The parity specs set `setSwordTimings(WEB_SWORD_TIMINGS)`,
  `setSwarmerHp(WEB_SWARMER_HP)`, `setBossHp(WEB_BOSS_HP)`, `setBowTuning(WEB_BOW_TUNING)`,
  `setPlayerMover(PlayerMover.WEB)` and `setSwordSpacing(SwordSpacing.WEB)`; a port retune adds its own setter there
  and every fixture still matches bit for bit.
- **New state is opt-in and hashed last.** A feature's `SimConfig` field is optional (absent = exactly as before), its
  hash group is appended after every existing one, and its rng is its own stream; M1, the fixtures and the tutorial
  must replay unchanged unless the entry says otherwise.
- **A gameplay change to endless bumps `DAILY.ruleset`**; the all-time boards stay `_v1`.
- **Archetypes number by (band, id).** A port archetype takes a new band so no recorded index moves
  (`sim/actors.spec.ts` holds the table).
- **The prediction mirror follows the sim.** A change to the player's motion or a weapon's `moveMultiplier` /
  spacing updates `shared/lockstep/predictMotion.ts` and keeps `predictMotion.spec.ts` passing.
- **Ported trig stays out of the sim**: bullet bursts read the arc tables, the Forge its own `dsin` / `dcos`.

## Commands

```
npm run verify      # typecheck -> lint -> format:check -> checks -> build -> headless tests. Run before you finish
npm test            # gen fixtures -> rbxtsc -> Lune runs every out/shared/**/*.spec
npm run test:only -- sim/rng   # rerun specs without rebuilding; args filter by source path
npm run test:only -- --shard 3/12   # one CI shard of the spec files (docs/CI.md); --list prints them instead
npm run test:only -- --census run/archer.survival   # opt-in census specs: their full sample (docs/ARCHER.md AR13)
npm run build       # gen fixtures -> rbxtsc -> out/
npm run dev         # rbxtsc -w + rojo serve
npm run build:place # publishable place: build/roblox-dungeons.rbxl from publish.project.json (no specs, fixtures or Jest)
npm run test:plugin # Studio test-runner plugin (same specs under real @rbxts/jest in Studio)
npm run art:build   # art/vendor -> art/build atlases + packs/vale/layout.ts / fxLayout.ts (art:lock rewrites art/vendor.lock.json)
npm run test:art    # node:test specs of the atlas pipeline (scripts/art/*.test.js; part of verify)
npm run audio:build # art/vendor/ninja-adventure/Audio -> art/build/audio/*.ogg + packs/vale/audioLayout.ts (audio:lock, audio:audition)
npm run l10n:export # (after build) English + l10n/context.json -> l10n/out/kv-strings*.csv for the Roblox cloud table
npm run l10n:import -- l10n/in/table.csv   # the whole downloaded cloud table -> shared/theme/locales/*.ts + l10n/report.md
npm run l10n:check  # (after build) translation coverage / stale / context report (test:l10n, check:autolocalize: in verify)
npm run check:kvnames # (in verify) every KV_* string in src/ is in scripts/kv-names.json and still used;
                    # docs/DEBUG_SWITCHES.md is its table: after adding a name, `npm run check:kvnames -- --write`
npm run check:locals # (after build; in verify) top-level locals of every compiled module: fails past Luau's 200, warns from 185
npm run docs        # TypeDoc -> build/api/index.html: the API reference from the doc comments, with docs/*.md as pages
                    # and every `docs/NAME.md` a link (about 33 s, never committed)
npm run docs:check  # (in verify) TypeDoc without output: fails on a broken {@link}, an unknown tag, a @param naming no parameter
npm run check:docs  # (in verify) every export has a /** */ (fields too in shared/sim, dungeon, lockstep), except the known
                    # gaps in scripts/doc-coverage.json; after documenting some: `npm run check:docs -- --update`
npm run out:digest -- --out build/out.before.txt   # (after build) out/ with comments stripped, one digest per module:
                    # digest before and after a comment-only change and `cmp` the two files
npm run facts       # (after build) regenerate docs/FACTS.md; verify runs facts:check and fails when it is stale
npm run tasks:open  # regenerate docs/OPEN_TASKS.md from the unchecked tasks in docs/*.md and the log's pending notes
npm run dump:lists -- --out build/lists.before.json   # (after build) every theme export as stable JSON: dump before
                    # and after a pure-move refactor and `cmp` the two files
```

Tools come from `rokit.toml` (`rokit install`): rojo 7.7.1, lune 0.11.0.

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
ESLint flags the same in the editor (`.eslintrc.json`: clock / RNG calls, Roblox globals, and any import outside
`shared/sim`, `shared/dungeon`, `shared/jsmath` and the generated fixtures); the runner stays the authority.

Port JS-isms deliberately: `.length` -> `.size()`, `null` -> `undefined`, 32-bit integer math through `bit32` and a
split-16-bit `imul`, no getters in sim state.

## Conventions

- **Janitor** for cleanup, never Maid.
- **Barrel `index.ts`** per directory. Import from the directory, not the file (generated fixtures are the exception).
- **`client/` and `server/` never import each other.** Shared contracts live in `shared/`.
- **A shared theme list is checked as a run, never by position.** A feature's spec asserts its own ids with
  `runOf(list, ids)` (`shared/theme/testing`): in the list, together, in order. Never pin a position from a list's
  end, a list's total, or another feature's ids: a later feature must be able to append without editing your spec.
  Lists whose order is recorded or hashed keep ONE lock spec (the archetype table: `sim/actors.spec.ts`; the Codex
  catalogue: `codex/catalog.spec.ts`).
- **Keep modules far from Luau's 200 top-level locals** (`check:locals`). Every imported name is one local. When a
  module passes about 150, split it into a directory with an `index.ts` that re-exports the same names (as
  `shared/theme/contract/`, `shared/theme/validate/` and `shared/view/sprites/` were), and prove the move with
  `dump:lists`.
- **Every exported declaration has a `/** */`** that says what the types cannot (units, ranges, what is hashed or
  mutated), prose first: no types in comments, `@param` / `@returns` only where they add something, a file header
  ends with `@module`, `{@link}` for symbols worth following; a plan doc is cited as plain `docs/NAME.md` (the site links it). In `shared/sim`, `shared/dungeon` and `shared/lockstep`
  every field of an exported interface has one too. `check:docs` fails on a new gap; never add a name to
  `scripts/doc-coverage.json` (docs/DOC_COMMENTS.md).
- **A new `KV_*` name needs a registry entry** in `scripts/kv-names.json` with its kind and a one-line description
  (`check:kvnames`).
- **A client remote's handler takes its limiter first**: the `player.Parent` guard, then `tryAcquire`, then the
  parse, any lookup and any reply (docs/SERVER_FINDINGS.md SFD4 lists the two deliberate exceptions).
- **Client and server code never call `print` / `warn`** (ESLint): the client logs through `client/log`
  (`logInfo` / `logWarn` pass the text unchanged, `clientLogger(source)` for new lines), the server through
  `server/log`. Never change the text of an existing line: docs and Studio checks quote them.
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
- A change lands on `main` by pull request with CI green (docs/CI.md): work on a branch, run `npm run verify`, push,
  open the pull request. Never push to `main` directly.
- Spikes and debug features are off by default (Workspace attributes / `shared/config`), cleaned up with Janitor.
  A spike's server half runs only in Studio or a place listed in `SPIKE_TEST_PLACES` (docs/SERVER_FINDINGS.md SFD2).
