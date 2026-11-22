# Docs

Where to start: [ARCHITECTURE.md](../ARCHITECTURE.md) for the shape of the system, then the six
[decision records](decisions/README.md). Everything below is the working record: one plan doc per feature, written
before the work and updated as built. The files stay flat in this folder because source comments cite them as
`docs/NAME.md` and the API reference links those citations (docs/DOC_COMMENTS.md DC11).

## Engineering

How the project is built, tested and kept correct, and the netcode work.

| Doc | What it covers |
|---|---|
| [DEVELOPING.md](DEVELOPING.md) | Contributor guide |
| [DECISIONS.md](DECISIONS.md) | The decision log: every deviation from `PLAN.md`, port retune and feature entry |
| [CI.md](CI.md) | CI on GitHub Actions: the `verify` stages in three jobs, the spec suite in 12 shards on x86-64 and arm64 |
| [CODEBASE_SCALE.md](CODEBASE_SCALE.md) | Codebase scale |
| [DOC_COMMENTS.md](DOC_COMMENTS.md) | Doc comments and the API reference |
| [REPO_HYGIENE.md](REPO_HYGIENE.md) | Repo hygiene |
| [PRESENTATION.md](PRESENTATION.md) | This cleanup pass: what a reviewer would find, what was done about it, what is still open |
| [FRAME_PACING.md](FRAME_PACING.md) | Co-op frame pacing |
| [LOCAL_PREDICTION.md](LOCAL_PREDICTION.md) | Local prediction in co-op |
| [ROLLBACK_SPIKE.md](ROLLBACK_SPIKE.md) | Rollback measurement spike, closed |
| [SERVER_CENSUS.md](SERVER_CENSUS.md) | Server census: what the server trusts, writes and tests |
| [SERVER_FINDINGS.md](SERVER_FINDINGS.md) | The census's ten findings closed: what was fixed, stated or accepted, and why |
| [SIM_CONTROLLER.md](SIM_CONTROLLER.md) | SimController: census and split |
| [ACTOR_RENDER.md](ACTOR_RENDER.md) | Actor render split |
| [CLIENT.md](CLIENT.md) | Client (task 8): the playable game loop, HUD, juice and audio |
| [SERVER.md](SERVER.md) | Server (task 9): run validation, telemetry, settings |
| [SPIKES.md](SPIKES.md) | Task 1 spikes: how to run them in Studio and the recorded results |
| [PRELOAD.md](PRELOAD.md) | Asset preloading |
| [STAGE_LOADER.md](STAGE_LOADER.md) | Stage loader |
| [STAGE_ASSETS.md](STAGE_ASSETS.md) | Stage assets |
| [LOCALIZATION.md](LOCALIZATION.md) | Language localization |
| [DEV_MODE.md](DEV_MODE.md) | Developer mode |

## Generated

Written by scripts and checked in `verify`. Never edited by hand.

| Doc | What it covers |
|---|---|
| [FACTS.md](FACTS.md) | Generated numbers |
| [OPEN_TASKS.md](OPEN_TASKS.md) | Generated list of every plan's unchecked tasks and the decision log's pending notes |
| [DEBUG_SWITCHES.md](DEBUG_SWITCHES.md) | Debug switches and stored names |

## Owner checklists

What still needs a person in Roblox Studio or on a device.

| Doc | What it covers |
|---|---|
| [STUDIO_PASS.md](STUDIO_PASS.md) | The Studio pass |
| [OPEN_TASKS_TRIAGE.md](OPEN_TASKS_TRIAGE.md) | Open tasks: triage |

## Features

One doc per gameplay or presentation feature: plan, decisions, tasks, as built.

| Doc | What it covers |
|---|---|
| [ARCHER.md](ARCHER.md) | The Archer |
| [BOOSTS.md](BOOSTS.md) | Temporary boosts dropped by killed enemies |
| [BOSS_DEMONLORD.md](BOSS_DEMONLORD.md) | Demon Lord boss variant |
| [BREAKABLE_DROPS.md](BREAKABLE_DROPS.md) | Boosts from breakables |
| [BUILDS.md](BUILDS.md) | Builds |
| [BUILDS_V2.md](BUILDS_V2.md) | Builds v2, wave 1 |
| [CODEX.md](CODEX.md) | Codex |
| [COMBO.md](COMBO.md) | Combo you chase |
| [COSMETICS.md](COSMETICS.md) | Cosmetics from recoloured sprites |
| [DAILY.md](DAILY.md) | Daily dungeon and seeded rosters |
| [DIFFICULTY.md](DIFFICULTY.md) | Dynamic difficulty ("Respite"): plan |
| [DRAFT_REVEAL.md](DRAFT_REVEAL.md) | Boon draft reveal |
| [ENEMY_VARIANTS.md](ENEMY_VARIANTS.md) | Enemy variants |
| [FEEL.md](FEEL.md) | Game feel pass |
| [FLOOR_MODIFIERS.md](FLOOR_MODIFIERS.md) | Floor modifiers |
| [FORTUNE.md](FORTUNE.md) | Fortune |
| [GAMEPAD_MENUS.md](GAMEPAD_MENUS.md) | Gamepad menus |
| [GOLDLING_RUMOURS.md](GOLDLING_RUMOURS.md) | Goldling hiding places and rumours |
| [GRAVEYARD.md](GRAVEYARD.md) | Graveyards: rows of solid graves in the playable area |
| [GRAZE_PARRY.md](GRAZE_PARRY.md) | Grazes and parries |
| [HAPTICS.md](HAPTICS.md) | Haptics in play |
| [HUD_LAYOUT.md](HUD_LAYOUT.md) | In-run HUD footprint |
| [INVITES.md](INVITES.md) | Roblox friend invites |
| [ITEM_TOOLTIPS.md](ITEM_TOOLTIPS.md) | Item tooltips: plan |
| [LEGENDARIES.md](LEGENDARIES.md) | Legendaries |
| [MINIMAP.md](MINIMAP.md) | Minimap with fog of war |
| [MOBILE.md](MOBILE.md) | Mobile play |
| [MOBILE_IMPL.md](MOBILE_IMPL.md) | Mobile play: implementation guide |
| [NEW_BEST.md](NEW_BEST.md) | New-best celebration |
| [NEW_ENEMIES.md](NEW_ENEMIES.md) | New enemies |
| [NEW_ENEMIES_2.md](NEW_ENEMIES_2.md) | New enemies 2 |
| [NEW_ENEMIES_3.md](NEW_ENEMIES_3.md) | New enemies 3 |
| [PELLETS.md](PELLETS.md) | Pellets |
| [PLAYER_NAMES.md](PLAYER_NAMES.md) | Co-op name tags |
| [PORTRAIT.md](PORTRAIT.md) | Portrait play |
| [ROOM_CLEAR.md](ROOM_CLEAR.md) | Room clear celebration |
| [ROOM_CLEAR_IMPL.md](ROOM_CLEAR_IMPL.md) | Room clear celebration: implementation guide |
| [ROOM_EDGES.md](ROOM_EDGES.md) | Room edges |
| [RUN_CONTRIBUTION.md](RUN_CONTRIBUTION.md) | Co-op contribution on the run-over screen |
| [RUN_RECAP.md](RUN_RECAP.md) | Run-over recap and co-op moments |
| [SECRET_ROOMS.md](SECRET_ROOMS.md) | Secret rooms |
| [SILVER.md](SILVER.md) | Silver, the cross-run currency |
| [SHOP_ANALYTICS.md](SHOP_ANALYTICS.md) | Shop analytics (the `Purchase` event) |
| [SILVER_SHOP.md](SILVER_SHOP.md) | Silver shop |
| [SPECTATE.md](SPECTATE.md) | Co-op spectating |
| [SWORD_SPACING.md](SWORD_SPACING.md) | Sword spacing |
| [TREASURE.md](TREASURE.md) | Treasure rooms |
| [TUTORIAL.md](TUTORIAL.md) | First-run tutorial |
| [TUTORIAL_ARROW.md](TUTORIAL_ARROW.md) | Tutorial guidance arrow |
| [TUTORIAL_FUNNEL.md](TUTORIAL_FUNNEL.md) | Tutorial analytics funnel |
| [TUTORIAL_MAP.md](TUTORIAL_MAP.md) | Tutorial map lesson |
| [WALL_SLIDE.md](WALL_SLIDE.md) | Wall slide |

## Art and audio

Asset packs, their pipelines and how each is mapped onto the game.

| Doc | What it covers |
|---|---|
| [ART.md](ART.md) | Vertical-slice art: packs, licences, contract v2, atlas pipeline, renderer, status |
| [DECOR.md](DECOR.md) | Room decoration: plan |
| [BOOKSHELVES.md](BOOKSHELVES.md) | Bookshelves |
| [BOOST_ART.md](BOOST_ART.md) | Boost drop art |
| [BRAMBLE_ART.md](BRAMBLE_ART.md) | Mother Mayhem |
| [CURSOR.md](CURSOR.md) | Gauntlet mouse cursor |
| [DEMON_ART.md](DEMON_ART.md) | Placeholder enemies as 2D Demons |
| [DUMMY_ART.md](DUMMY_ART.md) | Training dummy art |
| [FX_AUDIO.md](FX_AUDIO.md) | Sprite effects and audio |
| [GOO_ART.md](GOO_ART.md) | Goo art |
| [HAZARD_ART.md](HAZARD_ART.md) | Hazard art |
| [KENNEY_DECOR.md](KENNEY_DECOR.md) | Kenney decor |
| [OUTLINE.md](OUTLINE.md) | Enemy outlines |
| [PLAYER_OUTLINE.md](PLAYER_OUTLINE.md) | Player outline |
| [PROJECTILE_ART.md](PROJECTILE_ART.md) | Projectile art |
| [SNIPER_ART.md](SNIPER_ART.md) | Sniper art |
| [UI_ART.md](UI_ART.md) | UI art |
| [VOID_DECOR.md](VOID_DECOR.md) | Void decoration |
