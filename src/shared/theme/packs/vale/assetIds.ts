/**
 * Uploaded Roblox asset IDs for the `vale` pack, keyed by the art/build file name. THE ONLY FILE TO EDIT when art is
 * uploaded; everything else in the pack is generated (layout.ts) or derived (manifest.ts).
 *
 * How to fill it (art/README.md, "Uploading"):
 *   1. `npm run art:build` writes art/build/*.png (the packs must be in art/vendor/, see art/README.md).
 *   2. Upload every art/build/*.png (not art/build/contact/): in Studio via View > Asset Manager > Bulk Import, or
 *      with Asphalt (point its generated ID file inside src/shared/theme/, the only folder allowed to hold IDs).
 *   3. Paste each image's ID here, e.g.  "vanguard-run.png": "rbxassetid://<digits>",
 *   4. `npm run verify`.
 *
 * A sprite set switches from its placeholder to the art once the sheets of its REQUIRED animations have IDs
 * (class.vanguard: idle, run, roll, hit, death; enemy.swarmer: swarmer-move.png and swarmer-death.png); optional ones
 * (vanguard-attack1..3.png) join when their IDs are added. boss.demonlord (docs/BOSS_DEMONLORD.md D7): required
 * demonlord-idle / -move / -attack / -death.png (hit reuses idle's cells), optional demonlord-attack2 / -intro /
 * -taunt.png, plus one -outline.png per sheet (14 files). class.ranger (the Archer, docs/ARCHER.md AR12; built alone by
 * `node scripts/art/build-atlases.js --only class.ranger`): required ranger-idle / -run / -roll / -hit / -death.png,
 * optional ranger-attack1 / -attack2.png (the bow's stream and charged shot), plus one -outline.png per sheet (14
 * files; all 14 uploaded 2026-11-09); until the five required ones have IDs the Archer is the placeholder capsule. An enemy sheet's outline
 * (swarmer-move-outline.png, swarmer-death-outline.png) adds the baked rim once its ID is here; without it the set still
 * switches, rimless.
 * An image switches once its file has one. Re-upload (and paste the new ID) whenever `art:build` changes a PNG.
 *
 * Audio (art/README.md, "Audio"): `npm run audio:build` writes art/build/audio/*.ogg; paste each file's ID here the same
 * way ("sfx-player-hurt.ogg": "rbxassetid://<digits>"). A sound ID switches on once ALL of its files (its variants)
 * have IDs (audioLayout.ts lists them).
 */
import type { RobloxAssetId } from "../../types";

/**
 * Uploaded 2026-10-25 by k9kbdev (Studio Asset Manager, Bulk Import), transcribed from Asset Manager screenshots.
 * vanguard-attack3.png's ID is by elimination: it was the only remaining truncated "vanguard-atta..." row.
 * decor-atlas.png re-uploaded 2026-11-01 3:40 PM after its rebuild for docs/VOID_DECOR.md VD6 (+ tiles / wall1, - gems-*).
 * decor-atlas.png and decor-mote.png uploaded 2026-10-26 (docs/DECOR.md R5); that batch also re-uploaded the 13 files
 * above as duplicates with new IDs, which are not used (the images are byte-identical to the ones listed here).
 * swarmer-move.png / swarmer-death.png re-uploaded 2026-10-26 9:25 after the enemy-outline pad change (docs/OUTLINE.md
 * O3: 98x74 cells, 980x962 atlases), with swarmer-move-outline.png / swarmer-death-outline.png (O5). The two outline
 * names were truncated in Asset Manager ("swarmer-deat...", "swarmer-mov..."); each is the only file left with that prefix.
 * sniper-idle.png / sniper-idle-outline.png uploaded 2026-10-26 1:16 PM by k9kbdev (docs/SNIPER_ART.md SN6: 126x93
 * cells, 1008x744 atlas), transcribed from an Asset Manager screenshot.
 * bruiser-*.png (3 sheets + 3 outlines, docs/DEMON_ART.md DA6) and bramble-*.png (7 sheets + 7 outlines,
 * docs/BRAMBLE_ART.md BR6) uploaded 2026-10-26 3:48 PM by k9kbdev, transcribed from Asset Manager screenshots (the
 * SmallScaleInt "Top-down Demons" pack; licence in THIRD_PARTY_NOTICES.md).
 * The same batch uploaded the 14 demonlord-*.png sheets (Lords of Pain Demonlord, docs/BOSS_DEMONLORD.md); no sprite
 * set reads them yet, so they are not listed above (vale.spec: every ID must name an art/build file). Their IDs, for
 * when `boss.demonlord` lands: idle 88764271765384, idle-outline 103849445891803, move 70775680415093, move-outline
 * 110100254787435, attack 71694718471521, attack-outline 102763949876820, attack2 110239070941569, attack2-outline
 * 82560650525332, intro 117876056911897, intro-outline 86257913427010, taunt 140374029101007, taunt-outline
 * 81556574053660, death 73191082516513, death-outline 89185443391803.
 * Audio: 38 of the 54 art/build/audio/*.ogg files uploaded 2026-10-26 11:08 by k9kbdev (Asset Manager Bulk Import,
 * built by audio:build with ffmpeg 6.1.1), transcribed from Asset Manager screenshots. 15 more uploaded 2026-10-30
 * 12:08-12:10 PM by k9kbdev (amb-b1, the eight music-*.ogg, sfx-depth-up, sfx-enemy-hurt-3 / -4 / -6,
 * sfx-enemy-telegraph, sfx-stairwell-open), transcribed from Asset Manager screenshots. The room clear sounds
 * (docs/ROOM_CLEAR.md RC4: sfx-room-perfect, sfx-score-tick, sfx-score-land) were built and uploaded the same day.
 * (The same batch re-uploaded sfx-enemy-shoot as 103955792909072; its ID above is unchanged.)
 * sfx-player-shoot is NOT the pipeline's file: the owner chose an external clip, "djartmusic-arrow-twang_01-306041",
 * uploaded 2026-10-30 12:29 PM by k9kbdev, instead of art/audio.json's Ninja Adventure Launch.wav. audio:build still
 * writes sfx-player-shoot.ogg from Launch.wav (and audioLayout's `seconds` describes that file); do not upload that
 * build over this ID. Record the clip's source and licence in THIRD_PARTY_NOTICES.md.
 * vanguard-*-outline.png (the 8 knight outline sheets, player outline: 1 px, outline.clipAtCellEdge; the body sheets
 * are byte-identical, so their IDs above stay) uploaded 2026-10-28 8:35 AM by k9kbdev, transcribed from an Asset Manager
 * screenshot.
 * sprayer-*.png / caster-*.png (Demon Spawn 8 / 11 turrets, 2 sheets + 2 outlines each, docs/DEMON_ART.md DA13)
 * uploaded 2026-10-30 2:55 PM by k9kbdev, transcribed from Asset Manager screenshots.
 * The draft reveal sounds (docs/DRAFT_REVEAL.md DR9: sfx-draft-charge, sfx-draft-flip-1 / -2, sfx-draft-legendary,
 * sfx-draft-pick) uploaded 2026-10-30 6:32 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * sfx-draft-rare.ogg uploaded 2026-10-31 1:14 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * The six draft card images (ui-draft-back / -back-eyes / -card-common / -card-rare / -skull-left / -skull-right, cut
 * from the ToffeeCraft Horror UI sheet by art:build) uploaded 2026-10-30 6:33 PM by k9kbdev, transcribed from an Asset
 * Manager screenshot.
 * The UI skin (docs/UI_ART.md UA4: the 12 sliced ui-*.png pieces and the ui-icons.png atlas) uploaded 2026-10-30
 * 8:41 PM by k9kbdev, transcribed from Asset Manager screenshots. That batch also re-uploaded the six ui-draft-*.png
 * files as duplicates with new IDs, which are not used (the images are byte-identical to the ones listed here).
 * The enemy variants (docs/ENEMY_VARIANTS.md EV10 / EV11: slime-body.png and slime-body-outline.png for enemy.slime,
 * also drawn 0.6x for slime.small; sfx-enemy-blink / -summon / -split, sfx-affix-shieldbreak / -vengeful) uploaded
 * 2026-10-31 7:20 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * The imp (Imp 9) and summoner (Demon Spawn 10) sets (docs/ENEMY_VARIANTS.md EV10: imp-* / summoner-* attack, body and
 * death sheets with their outlines) uploaded 2026-10-31 7:50 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * loot-glint.png (the loaded barrel / crate twinkle, docs/BREAKABLE_DROPS.md; original art, scripts/art/gen-loot-glint.js)
 * uploaded 2026-11-01, ID given by the owner.
 * kit-cage-1 / -2 and kit-chains-1 / -2 (the trial 3D kit, docs/DECOR.md "3D kits") uploaded 2026-11-02 2:00 PM by
 * k9kbdev, transcribed from an Asset Manager screenshot; kit-chandelier-1.png 2026-11-02 2:28 PM; the second kit's
 * kit-banner / kit-sarcophagus / kit-candle-stand (docs/DECOR.md "3D kits") 2026-11-02 3:05 PM; kit-tomb-x / kit-tomb-z
 * (solid decor, docs/DECOR.md "Solid decor") 2026-11-02 6:07 PM; kit-carpet-x / -z, kit-carpet-end-x / -z, kit-statue-x
 * / -z and kit-throne-x / -z 2026-11-02 9:00 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * The new enemies (docs/NEW_ENEMIES.md NE9 / NE10: bomber-* / charger-* / reaper-* attack, body and death sheets with
 * their outlines; sfx-enemy-fuse / -charge / -blast / -stun / -spin) uploaded 2026-11-03 9:01 AM by k9kbdev,
 * transcribed from an Asset Manager screenshot. warbanner-* (the same upload) added 2026-11-04 from a wider screenshot.
 * stormcaller-* (the same upload) added 2026-11-04 once a screenshot showed the stormcaller-body pair.
 * The Goldling (docs/FORTUNE.md FO10: golden-move / golden-death and their outlines, the gold-recoloured skeleton)
 * uploaded 2026-11-04 5:03 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * sfx-enemy-strike (the Stormcaller's strike: "Lightning strike" by DRAGON-STUDIO, Pixabay 386161) uploaded 2026-11-03
 * 11:28 AM by k9kbdev as the downloaded MP3, transcribed from an Asset Manager screenshot.
 * sfx-pellet-eat ("Chomp" by Barnaby / cryptologymedia, Pixabay 155392) and sfx-pellet-sweep ("Swish swoosh woosh SFX
 * 27" by Stereogenic Studio, Pixabay 357164; docs/PELLETS.md PL7) uploaded 2026-11-03 by k9kbdev as the downloaded MP3s
 * (untrimmed, not normalised), transcribed from an Asset Manager screenshot; sfx-pellet-power ("Power up 01a" by EdR,
 * Pixabay 484722) the same day, the same way. The built OGGs (art/upload) can replace all three.
 * pellet.png and pellet-power.png (the pellet cubes, docs/PELLETS.md PL8; original art, scripts/art/gen-pellet.js,
 * built by `npm run art:build` into art/upload/) and kit-bookcase-x / -z (docs/BOOKSHELVES.md BK6) uploaded 2026-11-03
 * 6:20 PM, transcribed from an Asset Manager screenshot.
 * sfx-room-teamperfect (Success2 + Bonus/Gold1) and sfx-player-syncparry (Bonus/Bonus3; docs/RUN_RECAP.md CM7, built by
 * audio:build with ffmpeg 6.1.1) uploaded 2026-11-03 6:33 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * kit-table-x / -z and kit-chair-px / -pz / -nx / -nz (the library's reading area, docs/BOOKSHELVES.md RA5; Dungeon
 * Assets Pack by zver.3d) uploaded 2026-11-04 6:04 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * kit-chest / kit-chest-open (the vault chest, docs/TREASURE.md TR9; "Old Chest" by SebastianSosnowski, CC-BY 4.0)
 * uploaded 2026-11-04 7:43 AM, transcribed from an Asset Manager screenshot.
 * bullets.png (every flying projectile and the impact burst fx.bullet.hit, docs/PROJECTILE_ART.md PA8; the 16Bit Bullets
 * Asset Pack by J i m, built by `node scripts/art/build-atlases.js --only bullets`) uploaded 2026-11-05.
 * goo.png (the Ooze's goo puddles, docs/GOO_ART.md GA6; the Free Slimes Asset Pack by heimlich3, built by
 * `node scripts/art/build-atlases.js --only goo`) uploaded 2026-11-06 9:10 AM by k9kbdev, transcribed from an Asset
 * Manager screenshot.
 * vault-cage.png / treasure-column.png (the vault's cage and light column, docs/TREASURE.md TR9; original art,
 * scripts/art/gen-treasure-art.js, built by `node scripts/art/build-atlases.js --only treasure`) uploaded 2026-11-06
 * 11:29 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * boost-auras.png (the four boost auras at every stack rank, docs/BOOST_ART.md BAD3; original art,
 * scripts/art/gen-boost-auras.js, built by `node scripts/art/build-atlases.js --only boostAuras`) uploaded 2026-11-06
 * 11:29 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * kenney-bookcase-<look>-x / -z (the bookcase's alternative set: Kenney's Isometric Library, CC0, reprojected by
 * scripts/art/kenney/reproject.py; docs/KENNEY_DECOR.md) uploaded 2026-11-06 11:46 AM by k9kbdev, transcribed from an
 * Asset Manager screenshot.
 * dummy.png / dummy-outline.png (the tutorial's training dummy, docs/DUMMY_ART.md DA5; Training Dummy 2D Pixel Art)
 * uploaded 2026-11-06 12:09 PM by k9kbdev, transcribed from an Asset Manager screenshot.
 * kenney-bookcase-<wide look>-x / -z (the wide cases, docs/KENNEY_DECOR.md KN3) and kenney-patch-<look>-b<n> (the floor
 * patches baked per biome, KN4) uploaded 2026-11-06 1:19 PM by k9kbdev, transcribed from Asset Manager screenshots.
 * hazards.png (the Stormcaller's strike flash / scorch and the build embers, docs/HAZARD_ART.md HA7; original art,
 * scripts/art/gen-hazard-art.js, built by `node scripts/art/build-atlases.js --only hazards`) uploaded 2026-11-06, the ID
 * given by the owner in chat.
 * pact-altar.png / golden-coin.png (the pact altar and the Goldling's coin burst, docs/FORTUNE.md FO10; original art,
 * scripts/art/gen-fortune-art.js, built by `node scripts/art/build-atlases.js --only fortune`) uploaded 2026-11-06
 * 6:04 PM, transcribed from an Asset Manager screenshot.
 * boon-icons.png (one icon per boon, docs/BUILDS.md BU11; original art, scripts/art/gen-boon-icons.js, built by
 * `node scripts/art/build-atlases.js --only boonIcons`) uploaded 2026-11-08, the ID given by the owner in chat.
 * item-icons.png (one icon per relic and per curse, docs/BUILDS.md BU11; original art, scripts/art/gen-item-icons.js,
 * built by `node scripts/art/build-atlases.js --only itemIcons`) uploaded 2026-11-08, the ID given by the owner in chat.
 * boost-icons.png (one icon per temporary boost, docs/BOOSTS.md "As built: boost icons"; original art,
 * scripts/art/gen-boost-icons.js, built by `node scripts/art/build-atlases.js --only boostIcons`) uploaded 2026-11-08,
 * the ID given by the owner in chat.
 * pip-icons.png (the armor row's full / spent armor pips and the Aegis pip, docs/UI_ART.md "As built: armor pips";
 * original art, scripts/art/gen-pip-icons.js, built by `node scripts/art/build-atlases.js --only pipIcons`): the first
 * 9 x 9 sheet was uploaded 2026-11-08 (103884093874949) and is retired: the 16 x 15 sheet (the hearts' size) changed
 * every rect; the 16 x 15 sheet uploaded 2026-11-08, the ID given by the owner in chat.
 * heart-icons.png (the half-heart containers ui.heart.halfmax / .halfmax.empty, docs/SILVER.md SV16; cut from the UI
 * sheet's hearts by scripts/art/gen-heart-halfmax.js, built by `node scripts/art/build-atlases.js --only heartIcons`):
 * uploaded 2026-11-14, the ID given by the owner in chat (an Asset Manager screenshot).
 * duo-icons.png (one icon per duo, docs/BUILDS.md BU11; original art, scripts/art/gen-duo-icons.js, built by
 * `node scripts/art/build-atlases.js --only duoIcons`) and lop-patch-blotch1 / -2.png (the Lords of Pain floor blotches,
 * biome.1 floor patches 6 / 7, docs/KENNEY_DECOR.md; scripts/art/lop/floor_blotches.py) uploaded 2026-11-11, transcribed
 * from an Asset Manager screenshot the owner gave in chat.
 * sfx-boost-collect ("Pick up sfx", Pixabay 38516) and sfx-boost-expire ("Power down 02", Pixabay 82200; both by
 * freesound_community, docs/BOOSTS.md) uploaded 2026-11-08 10:17 AM by k9kbdev as built by audio:build, transcribed
 * from an Asset Manager screenshot. The same upload replaced sfx-pellet-power (was the raw MP3, 119476079306502),
 * sfx-player-syncparry (was 84948565537343) and sfx-room-teamperfect (was 82497842436869) with that build's OGGs.
 * sfx-boost-drop ("Retro Coin 4" by Driken Stan, Pixabay 236671) and sfx-boost-aegisbreak ("Plate Break 1" by
 * freesound_community, Pixabay 36468) uploaded 2026-11-08 by k9kbdev as built by audio:build, transcribed from an Asset
 * Manager screenshot.
 * The picks from the audition checklist (docs/FX_AUDIO.md "Sourcing the remaining silent IDs": Ninja Adventure, Kenney
 * Impact Sounds, OpenGameArt CC0) uploaded 2026-11-11 9:56 PM by k9kbdev as built by audio:build, 31 files transcribed
 * from Asset Manager screenshots; amb-b2, sfx-boss-taunt, sfx-breakable-loot and sfx-build-beam (the same upload) from a
 * second screenshot.
 * grave-<look>.png (the five gravestones, docs/DECOR.md "Graves"; original art, scripts/art/gen-grave-art.js, own
 * world art PNGs) uploaded 2026-11-08 10:25 AM by k9kbdev, transcribed from an Asset Manager screenshot.
 * tile-biome2-floor.png / tile-biome2-wall.png (the molten biome's floor and wall textures, docs/ART.md "As built:
 * molten tiles"; original art, scripts/art/molten/gen_molten_tiles.py) uploaded 2026-11-08 1:21 PM by k9kbdev,
 * transcribed from an Asset Manager screenshot.
 * kenney-decor.png (the Kenney Forge pieces' sheet, docs/KENNEY_DECOR.md KN12) and tile-biome3-floor.png /
 * tile-biome3-wall.png (the frost biome's floor and wall textures, docs/ART.md "As built: frost tiles"; original art,
 * scripts/art/frost/gen_frost_tiles.py) uploaded 2026-11-08, transcribed from an Asset Manager screenshot.
 * tile-biome4-floor.png / tile-biome4-wall.png (the grim biome's, docs/ART.md "As built: grim tiles"; original art,
 * scripts/art/grim/gen_grim_tiles.py) and tile-biome5-floor.png / tile-biome5-wall.png (the verdant biome's, docs/ART.md
 * "As built: verdant tiles"; original art, scripts/art/verdant/gen_verdant_tiles.py) uploaded 2026-11-09 6:56 AM by
 * k9kbdev, transcribed from an Asset Manager screenshot.
 * secret.png (the secret rooms' crack overlay, rubble and dust trickle, docs/SECRET_ROOMS.md SR11; original art,
 * scripts/art/gen-secret-art.js, built by `node scripts/art/build-atlases.js --only secret`) uploaded 2026-11-13, the ID
 * given by the owner in chat: it switches on `secret.crack`, `secret.rubble` and `fx.secret.dust`.
 * The floor modifier stings (docs/FLOOR_MODIFIERS.md FM10: sfx-floor-modifier-gilded / -hoard / -feast / -plunder /
 * -bloodmoon) and the secret rooms' sounds (docs/SECRET_ROOMS.md SR14: sfx-secret-knock, sfx-secret-open,
 * sfx-jingle-secret) uploaded 2026-11-13 as built by audio:build, transcribed from an Asset Manager screenshot.
 */
export const VALE_ASSET_IDS: Readonly<Record<string, RobloxAssetId>> = {
	"amb-b1.ogg": "rbxassetid://91158343621799",
	"amb-b3.ogg": "rbxassetid://123793639672129",
	"amb-b4.ogg": "rbxassetid://106702179717675",
	"amb-b5.ogg": "rbxassetid://113010219687537",
	"bomber-attack-outline.png": "rbxassetid://89271626729003",
	"bomber-attack.png": "rbxassetid://133841842811524",
	"bomber-body-outline.png": "rbxassetid://126396598336502",
	"bomber-body.png": "rbxassetid://111448586144487",
	"bomber-death-outline.png": "rbxassetid://76498890264159",
	"bomber-death.png": "rbxassetid://135000310498445",
	"boon-icons.png": "rbxassetid://120375465703784",
	"boost-aegis.png": "rbxassetid://140457804095686",
	"boost-auras.png": "rbxassetid://102860615301253",
	"boost-frenzy.png": "rbxassetid://123942115924560",
	"boost-fury.png": "rbxassetid://81008876085390",
	"boost-icons.png": "rbxassetid://98909071423779",
	"boost-quickstep.png": "rbxassetid://94521729890331",
	"bramble-attack1-outline.png": "rbxassetid://107870513920568",
	"bramble-attack1.png": "rbxassetid://108836550185712",
	"bramble-attack2-outline.png": "rbxassetid://139984831911345",
	"bramble-attack2.png": "rbxassetid://91867315426425",
	"bramble-attack4-outline.png": "rbxassetid://106157127639141",
	"bramble-attack4.png": "rbxassetid://104705525907752",
	"bramble-death-outline.png": "rbxassetid://127959662776491",
	"bramble-death.png": "rbxassetid://137116588640646",
	"bramble-idle-outline.png": "rbxassetid://115426512435787",
	"bramble-idle.png": "rbxassetid://135664136659822",
	"bramble-move-outline.png": "rbxassetid://95133127071099",
	"bramble-move.png": "rbxassetid://102200134129141",
	"bramble-taunt-outline.png": "rbxassetid://92323505688562",
	"bramble-taunt.png": "rbxassetid://86735316800266",
	"bruiser-attack-outline.png": "rbxassetid://76264421691475",
	"bruiser-attack.png": "rbxassetid://104607301796555",
	"bruiser-body-outline.png": "rbxassetid://80696842916743",
	"bruiser-body.png": "rbxassetid://139345385245627",
	"bruiser-death-outline.png": "rbxassetid://96190576749559",
	"bruiser-death.png": "rbxassetid://110099154312685",
	"bullets.png": "rbxassetid://137901113047611",
	"caster-body-outline.png": "rbxassetid://117972314048279",
	"caster-body.png": "rbxassetid://94738405031552",
	"caster-death-outline.png": "rbxassetid://128357725222665",
	"caster-death.png": "rbxassetid://78384490395919",
	"charger-attack-outline.png": "rbxassetid://125921086335051",
	"charger-attack.png": "rbxassetid://89456289763504",
	"charger-body-outline.png": "rbxassetid://128065911487577",
	"charger-body.png": "rbxassetid://116933894744611",
	"charger-death-outline.png": "rbxassetid://94883878686509",
	"charger-death.png": "rbxassetid://83176562450531",
	"decor-atlas.png": "rbxassetid://115064942223814",
	"dummy-outline.png": "rbxassetid://114899302767067",
	"dummy.png": "rbxassetid://76011095585692",
	"duo-icons.png": "rbxassetid://90883501251408",
	"decor-mote.png": "rbxassetid://108281638823690",
	"golden-coin.png": "rbxassetid://102072224489625",
	"golden-death-outline.png": "rbxassetid://129944301136987",
	"golden-death.png": "rbxassetid://92086087611208",
	"golden-move-outline.png": "rbxassetid://85083036932400",
	"golden-move.png": "rbxassetid://88829506171960",
	"goo.png": "rbxassetid://82002931490706",
	"grave-cracked.png": "rbxassetid://134206232347197",
	"grave-cross.png": "rbxassetid://72764310358371",
	"grave-obelisk.png": "rbxassetid://72332549557704",
	"grave-rounded.png": "rbxassetid://105320544067356",
	"grave-skull.png": "rbxassetid://113527738840348",
	"hazards.png": "rbxassetid://121912104813388",
	"heart-icons.png": "rbxassetid://133175128335720",
	"item-icons.png": "rbxassetid://82172693899829",
	"imp-attack-outline.png": "rbxassetid://87826495349638",
	"imp-attack.png": "rbxassetid://106802821695726",
	"imp-body-outline.png": "rbxassetid://80038327609999",
	"imp-body.png": "rbxassetid://130645679779456",
	"imp-death-outline.png": "rbxassetid://134104614361499",
	"imp-death.png": "rbxassetid://84336726009588",
	"kenney-decor.png": "rbxassetid://103391851167045",
	"kenney-bookcase-books-x.png": "rbxassetid://112414765339087",
	"kenney-bookcase-books-z.png": "rbxassetid://127677993573030",
	"kenney-bookcase-destroyed-x.png": "rbxassetid://90622744050525",
	"kenney-bookcase-destroyed-z.png": "rbxassetid://94762364313121",
	"kenney-bookcase-empty-x.png": "rbxassetid://107272320382488",
	"kenney-bookcase-empty-z.png": "rbxassetid://71512564076260",
	"kenney-bookcase-glass-x.png": "rbxassetid://80368932112331",
	"kenney-bookcase-glass-z.png": "rbxassetid://99803127612931",
	"kenney-bookcase-half-x.png": "rbxassetid://116468486814527",
	"kenney-bookcase-half-z.png": "rbxassetid://103656262277776",
	"kenney-bookcase-halfempty-x.png": "rbxassetid://78793568985165",
	"kenney-bookcase-halfempty-z.png": "rbxassetid://78252980421940",
	"kenney-bookcase-ladder-x.png": "rbxassetid://121772944601941",
	"kenney-bookcase-ladder-z.png": "rbxassetid://115785769946654",
	"kenney-bookcase-halfwide-x.png": "rbxassetid://86982688317264",
	"kenney-bookcase-halfwide-z.png": "rbxassetid://76232971665677",
	"kenney-bookcase-halfwideempty-x.png": "rbxassetid://123107088475987",
	"kenney-bookcase-halfwideempty-z.png": "rbxassetid://85835306763362",
	"kenney-bookcase-wide-x.png": "rbxassetid://73592431952419",
	"kenney-bookcase-wide-z.png": "rbxassetid://132522828458814",
	"kenney-bookcase-wideempty-x.png": "rbxassetid://70911647126590",
	"kenney-bookcase-wideempty-z.png": "rbxassetid://89308490963758",
	"kenney-bookcase-wideemptyladder-x.png": "rbxassetid://97557865535998",
	"kenney-bookcase-wideemptyladder-z.png": "rbxassetid://134922443250686",
	"kenney-bookcase-wideladder-x.png": "rbxassetid://91090435536955",
	"kenney-bookcase-wideladder-z.png": "rbxassetid://136321455247168",
	"kenney-patch-dirt-b1.png": "rbxassetid://106808980166159",
	"kenney-patch-dirt-b2.png": "rbxassetid://84599450702723",
	"kenney-patch-dirt-b3.png": "rbxassetid://133323430917210",
	"kenney-patch-dirt-b4.png": "rbxassetid://132117458140585",
	"kenney-patch-dirt-b5.png": "rbxassetid://103177656574611",
	"kenney-patch-planks-a-b1.png": "rbxassetid://112257771391402",
	"kenney-patch-planks-a-b2.png": "rbxassetid://92214403066209",
	"kenney-patch-planks-a-b3.png": "rbxassetid://76240479993475",
	"kenney-patch-planks-a-b4.png": "rbxassetid://86757147735912",
	"kenney-patch-planks-a-b5.png": "rbxassetid://102389310818522",
	"kenney-patch-planks-b-b1.png": "rbxassetid://111418042702167",
	"kenney-patch-planks-b-b2.png": "rbxassetid://93335932527141",
	"kenney-patch-planks-b-b3.png": "rbxassetid://126423313445326",
	"kenney-patch-planks-b-b4.png": "rbxassetid://85115393663777",
	"kenney-patch-planks-b-b5.png": "rbxassetid://84975084756765",
	"kenney-patch-planksbroken-a-b1.png": "rbxassetid://126208999323093",
	"kenney-patch-planksbroken-a-b2.png": "rbxassetid://131061955577377",
	"kenney-patch-planksbroken-a-b3.png": "rbxassetid://117367660380486",
	"kenney-patch-planksbroken-a-b4.png": "rbxassetid://72785665220086",
	"kenney-patch-planksbroken-a-b5.png": "rbxassetid://72971602388446",
	"kenney-patch-planksbroken-b-b1.png": "rbxassetid://104648278764535",
	"kenney-patch-planksbroken-b-b2.png": "rbxassetid://138688966778513",
	"kenney-patch-planksbroken-b-b3.png": "rbxassetid://130432145775566",
	"kenney-patch-planksbroken-b-b4.png": "rbxassetid://125543174873336",
	"kenney-patch-planksbroken-b-b5.png": "rbxassetid://116604869772401",
	"lop-patch-blotch1.png": "rbxassetid://111897142511672",
	"lop-patch-blotch2.png": "rbxassetid://131620628857220",
	"kit-banner.png": "rbxassetid://116783891005736",
	"kit-bookcase-x.png": "rbxassetid://84780192220821",
	"kit-bookcase-z.png": "rbxassetid://106394405354637",
	"kit-cage-1.png": "rbxassetid://120653442756216",
	"kit-cage-2.png": "rbxassetid://131457766065364",
	"kit-candle-stand.png": "rbxassetid://82067548860168",
	"kit-carpet-end-x.png": "rbxassetid://98404179034343",
	"kit-carpet-end-z.png": "rbxassetid://89651999047190",
	"kit-carpet-x.png": "rbxassetid://100324360941554",
	"kit-carpet-z.png": "rbxassetid://135285538764706",
	"kit-chair-nx.png": "rbxassetid://133067783649615",
	"kit-chair-nz.png": "rbxassetid://122253624249089",
	"kit-chair-px.png": "rbxassetid://108393511672563",
	"kit-chair-pz.png": "rbxassetid://101694939623100",
	"kit-chains-1.png": "rbxassetid://78196216486149",
	"kit-chains-2.png": "rbxassetid://132113945005181",
	"kit-chandelier-1.png": "rbxassetid://135009681923399",
	"kit-chest-open.png": "rbxassetid://106906788119340",
	"kit-chest.png": "rbxassetid://76282590856030",
	"kit-sarcophagus.png": "rbxassetid://71399333921022",
	"kit-statue-x.png": "rbxassetid://78332468478600",
	"kit-statue-z.png": "rbxassetid://98306419255246",
	"kit-table-x.png": "rbxassetid://127976474422668",
	"kit-table-z.png": "rbxassetid://96818770768214",
	"kit-throne-x.png": "rbxassetid://76830723915108",
	"kit-throne-z.png": "rbxassetid://115285373007373",
	"kit-tomb-x.png": "rbxassetid://137283582236805",
	"kit-tomb-z.png": "rbxassetid://137140622390095",
	"loot-glint.png": "rbxassetid://92133950711891",
	"music-biome-1.ogg": "rbxassetid://93211571195066",
	"music-biome-2.ogg": "rbxassetid://119153958408720",
	"music-biome-3.ogg": "rbxassetid://132935445941795",
	"music-biome-4.ogg": "rbxassetid://101517228477138",
	"music-biome-5.ogg": "rbxassetid://87253612195837",
	"music-boss.ogg": "rbxassetid://82229819920090",
	"music-menu.ogg": "rbxassetid://75564975309420",
	"music-tutorial.ogg": "rbxassetid://87339075756554",
	"pact-altar.png": "rbxassetid://117430889650812",
	"pellet-power.png": "rbxassetid://135982735087293",
	"pellet.png": "rbxassetid://104506728931703",
	"pip-icons.png": "rbxassetid://71522432232413",
	"ranger-attack1-outline.png": "rbxassetid://115346256665198",
	"ranger-attack1.png": "rbxassetid://97643800844303",
	"ranger-attack2-outline.png": "rbxassetid://98739153490049",
	"ranger-attack2.png": "rbxassetid://138730558586678",
	"ranger-death-outline.png": "rbxassetid://138896071792664",
	"ranger-death.png": "rbxassetid://82801610363541",
	"ranger-hit-outline.png": "rbxassetid://121971475424531",
	"ranger-hit.png": "rbxassetid://136370905401367",
	"ranger-idle-outline.png": "rbxassetid://86239102477732",
	"ranger-idle.png": "rbxassetid://119848240370322",
	"ranger-roll-outline.png": "rbxassetid://130538671597003",
	"ranger-roll.png": "rbxassetid://128683520092482",
	"ranger-run-outline.png": "rbxassetid://71973016283729",
	"ranger-run.png": "rbxassetid://86548765714980",
	"reaper-attack-outline.png": "rbxassetid://95992799302634",
	"reaper-attack.png": "rbxassetid://81078161742843",
	"reaper-body-outline.png": "rbxassetid://130853749528261",
	"reaper-body.png": "rbxassetid://75857827785103",
	"reaper-death-outline.png": "rbxassetid://138125634876332",
	"reaper-death.png": "rbxassetid://117603043827937",
	"secret.png": "rbxassetid://94136627623334",
	"sfx-affix-shieldbreak.ogg": "rbxassetid://116871435989650",
	"sfx-affix-vengeful.ogg": "rbxassetid://122645585698044",
	"sfx-best-new.ogg": "rbxassetid://139947943484777",
	"sfx-boss-death.ogg": "rbxassetid://98231076745245",
	"sfx-boss-roar.ogg": "rbxassetid://103385650363670",
	"sfx-boost-aegisbreak.ogg": "rbxassetid://80580285857653",
	"sfx-boost-collect.ogg": "rbxassetid://71429770968359",
	"sfx-boost-drop.ogg": "rbxassetid://104321784920923",
	"sfx-boost-expire.ogg": "rbxassetid://84893927450014",
	"sfx-breakable-break.ogg": "rbxassetid://116444193017210",
	"sfx-breakable-hit.ogg": "rbxassetid://77751477617243",
	"sfx-combo-break.ogg": "rbxassetid://82071923495161",
	"sfx-combo-tier.ogg": "rbxassetid://126389092133631",
	"sfx-depth-up.ogg": "rbxassetid://103313193441379",
	"sfx-draft-charge.ogg": "rbxassetid://81715740410141",
	"sfx-draft-flip-1.ogg": "rbxassetid://107162978839359",
	"sfx-draft-flip-2.ogg": "rbxassetid://106814155399198",
	"sfx-draft-legendary.ogg": "rbxassetid://119499678299322",
	"sfx-draft-pick.ogg": "rbxassetid://85146648456597",
	"sfx-draft-rare.ogg": "rbxassetid://116974688136700",
	"sfx-ember.ogg": "rbxassetid://132331997932373",
	"sfx-enemy-blast.ogg": "rbxassetid://83012331491758",
	"sfx-enemy-blink.ogg": "rbxassetid://102016664523463",
	"sfx-enemy-charge.ogg": "rbxassetid://112796149650603",
	"sfx-enemy-death-1.ogg": "rbxassetid://120112698995155",
	"sfx-enemy-death-2.ogg": "rbxassetid://139105704609425",
	"sfx-enemy-death-3.ogg": "rbxassetid://100811224100190",
	"sfx-enemy-fuse.ogg": "rbxassetid://87991850386395",
	"sfx-enemy-hurt-1.ogg": "rbxassetid://92848072200948",
	"sfx-enemy-hurt-2.ogg": "rbxassetid://72455668388301",
	"sfx-enemy-hurt-3.ogg": "rbxassetid://136247486392757",
	"sfx-enemy-hurt-4.ogg": "rbxassetid://81745704195515",
	"sfx-enemy-hurt-5.ogg": "rbxassetid://116770794061890",
	"sfx-enemy-hurt-6.ogg": "rbxassetid://85101791814178",
	"sfx-enemy-shoot.ogg": "rbxassetid://117798043671657",
	"sfx-enemy-spin.ogg": "rbxassetid://93754810963439",
	"sfx-enemy-strike.ogg": "rbxassetid://100378513065418",
	"sfx-enemy-split.ogg": "rbxassetid://114706012715735",
	"sfx-enemy-stun.ogg": "rbxassetid://119936963078837",
	"sfx-enemy-summon.ogg": "rbxassetid://84041560036469",
	"sfx-enemy-telegraph.ogg": "rbxassetid://135727302886058",
	"sfx-floor-enter.ogg": "rbxassetid://136963659016362",
	"sfx-friend-passed.ogg": "rbxassetid://118874523894435",
	"sfx-jingle-gameover.ogg": "rbxassetid://100204013637893",
	"sfx-jingle-record.ogg": "rbxassetid://136565259970905",
	"sfx-pellet-eat.ogg": "rbxassetid://140235243025020",
	"sfx-pellet-power.ogg": "rbxassetid://86595394427576",
	"sfx-pellet-sweep.ogg": "rbxassetid://91831138556237",
	"sfx-player-charged.ogg": "rbxassetid://134000846415949",
	"sfx-player-death.ogg": "rbxassetid://116272723028955",
	"sfx-player-deflect.ogg": "rbxassetid://111196234749460",
	"sfx-player-finisher.ogg": "rbxassetid://126253596804652",
	"sfx-player-flask.ogg": "rbxassetid://132402914407938",
	"sfx-player-graze.ogg": "rbxassetid://75883031011439",
	"sfx-player-hurt.ogg": "rbxassetid://109847922628008",
	"sfx-player-parry.ogg": "rbxassetid://124974710844270",
	"sfx-player-roll.ogg": "rbxassetid://73804106008724",
	"sfx-player-shoot.ogg": "rbxassetid://98736803949938",
	"sfx-player-swap.ogg": "rbxassetid://88978044362008",
	"sfx-player-swing-1.ogg": "rbxassetid://81803616082630",
	"sfx-player-swing-2.ogg": "rbxassetid://120871115343244",
	"sfx-player-swing-3.ogg": "rbxassetid://77155197597647",
	"sfx-player-swing-4.ogg": "rbxassetid://123568922754251",
	"sfx-player-swing-5.ogg": "rbxassetid://119336453391941",
	"sfx-player-syncparry.ogg": "rbxassetid://86800062008466",
	"sfx-rank-up.ogg": "rbxassetid://72950951266263",
	"sfx-relic-take.ogg": "rbxassetid://117702527882611",
	"sfx-room-clear.ogg": "rbxassetid://91705259787657",
	"sfx-room-perfect.ogg": "rbxassetid://126017159048037",
	"sfx-room-teamperfect.ogg": "rbxassetid://128281307405603",
	"sfx-score-land.ogg": "rbxassetid://77069986772456",
	"sfx-score-tick.ogg": "rbxassetid://117631758592807",
	"sfx-shrine-use.ogg": "rbxassetid://116463287240842",
	"sfx-stairwell-open.ogg": "rbxassetid://85934761619292",
	"sfx-ui-back.ogg": "rbxassetid://97552556590703",
	"sfx-ui-click.ogg": "rbxassetid://81382073811691",
	"sfx-ui-confirm.ogg": "rbxassetid://129583273016065",
	"sfx-ui-move.ogg": "rbxassetid://98968775960499",
	"sfx-victory.ogg": "rbxassetid://138562382025197",
	"sfx-build-beam.ogg": "rbxassetid://107320143421087",
	"sfx-build-brace.ogg": "rbxassetid://131702853786466",
	"sfx-build-burst.ogg": "rbxassetid://137428773165639",
	"sfx-build-counter.ogg": "rbxassetid://127620694827762",
	"sfx-build-duo.ogg": "rbxassetid://108457797205594",
	"sfx-build-ember.ogg": "rbxassetid://121718463634893",
	"sfx-build-evolve.ogg": "rbxassetid://107585516035166",
	"sfx-build-execute.ogg": "rbxassetid://119554509996955",
	"sfx-build-jackpot.ogg": "rbxassetid://83143085411619",
	"sfx-build-nova.ogg": "rbxassetid://126598742196767",
	"sfx-build-overkill.ogg": "rbxassetid://114557631378046",
	"sfx-build-pin.ogg": "rbxassetid://87829869756188",
	"sfx-build-shard.ogg": "rbxassetid://108190596023853",
	"sfx-build-slam-1.ogg": "rbxassetid://71609476290138",
	"sfx-build-slam-2.ogg": "rbxassetid://96477815538911",
	"sfx-build-slam-3.ogg": "rbxassetid://81592673405654",
	"sfx-build-smash.ogg": "rbxassetid://134543356878311",
	"sfx-build-spark.ogg": "rbxassetid://123551644430335",
	"amb-b2.ogg": "rbxassetid://84470694394747",
	"sfx-boss-taunt.ogg": "rbxassetid://114123945324646",
	"sfx-breakable-loot.ogg": "rbxassetid://135727786889304",
	"sfx-golden-appear.ogg": "rbxassetid://102235846548497",
	"sfx-golden-escape.ogg": "rbxassetid://80710768689206",
	"sfx-golden-hit.ogg": "rbxassetid://139364139046372",
	"sfx-golden-jackpot.ogg": "rbxassetid://113621437177810",
	"sfx-horde-double.ogg": "rbxassetid://139381436835109",
	"sfx-horde-horn.ogg": "rbxassetid://113615316454201",
	"sfx-horde-wave.ogg": "rbxassetid://98733707329120",
	"sfx-jingle-treasure.ogg": "rbxassetid://79661760081714",
	"sfx-loot-drop.ogg": "rbxassetid://79146160329570",
	"sfx-loot-rare.ogg": "rbxassetid://114749102123684",
	"sfx-pact-take.ogg": "rbxassetid://102959594693498",
	"sfx-treasure-crack.ogg": "rbxassetid://129473916727514",
	"sfx-treasure-open.ogg": "rbxassetid://91726633163994",
	"sfx-treasure-unlock.ogg": "rbxassetid://134958985801748",
	"sfx-floor-modifier-bloodmoon.ogg": "rbxassetid://83853491859963",
	"sfx-floor-modifier-feast.ogg": "rbxassetid://83948020310759",
	"sfx-floor-modifier-gilded.ogg": "rbxassetid://103239728071115",
	"sfx-floor-modifier-hoard.ogg": "rbxassetid://87311550138224",
	"sfx-floor-modifier-plunder.ogg": "rbxassetid://130331294126570",
	"sfx-jingle-secret.ogg": "rbxassetid://114009226023976",
	"sfx-secret-knock.ogg": "rbxassetid://123265297415244",
	"sfx-secret-open.ogg": "rbxassetid://111183685070047",
	"sfx-golden-rumour-floor.ogg": "rbxassetid://107519507930548",
	"sfx-golden-rumour-room.ogg": "rbxassetid://81580713668618",
	"sfx-shop-buy.ogg": "rbxassetid://133370704114098",
	"sfx-shop-deny.ogg": "rbxassetid://137703035630569",
	"sfx-silver-crate.ogg": "rbxassetid://127624772687698",
	"sfx-silver-gain.ogg": "rbxassetid://107955824815399",
	"slime-body-outline.png": "rbxassetid://125641170965641",
	"slime-body.png": "rbxassetid://105955364807363",
	"sniper-idle-outline.png": "rbxassetid://72531972026139",
	"sniper-idle.png": "rbxassetid://136813347348140",
	"sprayer-body-outline.png": "rbxassetid://113789975034893",
	"sprayer-body.png": "rbxassetid://91705891235798",
	"sprayer-death-outline.png": "rbxassetid://84907988039450",
	"sprayer-death.png": "rbxassetid://103488605375534",
	"stormcaller-attack-outline.png": "rbxassetid://113129536919777",
	"stormcaller-attack.png": "rbxassetid://98689179931162",
	"stormcaller-body-outline.png": "rbxassetid://72828372329846",
	"stormcaller-body.png": "rbxassetid://79804185202292",
	"stormcaller-death-outline.png": "rbxassetid://123020171014128",
	"stormcaller-death.png": "rbxassetid://117013780053629",
	"summoner-attack-outline.png": "rbxassetid://71799709544334",
	"summoner-attack.png": "rbxassetid://78838021771893",
	"summoner-body-outline.png": "rbxassetid://118322277029322",
	"summoner-body.png": "rbxassetid://93404933546612",
	"summoner-death-outline.png": "rbxassetid://80709656173090",
	"summoner-death.png": "rbxassetid://102657103898767",
	"swarmer-death-outline.png": "rbxassetid://72521271467524",
	"swarmer-death.png": "rbxassetid://101974921579587",
	"swarmer-move-outline.png": "rbxassetid://71928565662655",
	"swarmer-move.png": "rbxassetid://123202950556458",
	"tile-biome1-floor.png": "rbxassetid://98164459682194",
	"tile-biome2-floor.png": "rbxassetid://100132893234485",
	"tile-biome2-wall.png": "rbxassetid://111148927425576",
	"tile-biome3-floor.png": "rbxassetid://103567277258288",
	"tile-biome3-wall.png": "rbxassetid://102833424816991",
	"tile-biome4-floor.png": "rbxassetid://96561145070596",
	"tile-biome4-wall.png": "rbxassetid://86828307319715",
	"tile-biome5-floor.png": "rbxassetid://108289710149110",
	"tile-biome5-wall.png": "rbxassetid://99876348099559",
	"treasure-column.png": "rbxassetid://90798930010648",
	"ui-bar-fill.png": "rbxassetid://77055366404694",
	"ui-bar-track.png": "rbxassetid://102111490052610",
	"ui-button-disabled.png": "rbxassetid://127150562683800",
	"ui-button-focus.png": "rbxassetid://123935262412449",
	"ui-button.png": "rbxassetid://107732705819497",
	"ui-cursor-hover.png": "rbxassetid://105045987009903",
	"ui-cursor.png": "rbxassetid://99705434998185",
	"ui-draft-back-eyes.png": "rbxassetid://101806914395578",
	"ui-draft-back.png": "rbxassetid://107712653809455",
	"ui-draft-card-common.png": "rbxassetid://134898571956574",
	"ui-draft-card-rare.png": "rbxassetid://123306051421744",
	"ui-draft-skull-left.png": "rbxassetid://116162957164169",
	"ui-draft-skull-right.png": "rbxassetid://73547490089053",
	"ui-icons.png": "rbxassetid://81953401024187",
	"ui-marker-boost.png": "rbxassetid://112357573917505",
	"ui-marker-pedestal.png": "rbxassetid://126528421886645",
	"ui-option-off.png": "rbxassetid://73639480231098",
	"ui-option-on.png": "rbxassetid://80273358331830",
	"ui-panel-hud.png": "rbxassetid://81285223221947",
	"ui-panel-menu.png": "rbxassetid://130316695278027",
	"ui-panel-tall.png": "rbxassetid://123720256684597",
	"ui-ring-player.png": "rbxassetid://111980900819302",
	"ui-slot-pair.png": "rbxassetid://87197162434084",
	"ui-slot.png": "rbxassetid://136314174801916",
	"vanguard-attack1-outline.png": "rbxassetid://95853451012948",
	"vanguard-attack1.png": "rbxassetid://132423462677316",
	"vanguard-attack2-outline.png": "rbxassetid://128123331343868",
	"vanguard-attack2.png": "rbxassetid://139632320163472",
	"vanguard-attack3-outline.png": "rbxassetid://131958607392874",
	"vanguard-attack3.png": "rbxassetid://81872310850391",
	"vanguard-death-outline.png": "rbxassetid://125767093717695",
	"vanguard-death.png": "rbxassetid://138909624937484",
	"vanguard-hit-outline.png": "rbxassetid://108411818015171",
	"vanguard-hit.png": "rbxassetid://127829250065405",
	"vanguard-idle-outline.png": "rbxassetid://119748457323306",
	"vanguard-idle.png": "rbxassetid://126099595216301",
	"vanguard-roll-outline.png": "rbxassetid://98834749208965",
	"vanguard-roll.png": "rbxassetid://113453153969851",
	"vanguard-run-outline.png": "rbxassetid://135965842289036",
	"vanguard-run.png": "rbxassetid://98583531315344",
	"vault-cage.png": "rbxassetid://92880331034626",
	"demonlord-attack-outline.png": "rbxassetid://102763949876820",
	"demonlord-attack.png": "rbxassetid://71694718471521",
	"demonlord-attack2-outline.png": "rbxassetid://82560650525332",
	"demonlord-attack2.png": "rbxassetid://110239070941569",
	"demonlord-death-outline.png": "rbxassetid://89185443391803",
	"demonlord-death.png": "rbxassetid://73191082516513",
	"demonlord-idle-outline.png": "rbxassetid://103849445891803",
	"demonlord-idle.png": "rbxassetid://88764271765384",
	"demonlord-intro-outline.png": "rbxassetid://86257913427010",
	"demonlord-intro.png": "rbxassetid://117876056911897",
	"demonlord-move-outline.png": "rbxassetid://110100254787435",
	"demonlord-move.png": "rbxassetid://70775680415093",
	"demonlord-taunt-outline.png": "rbxassetid://81556574053660",
	"demonlord-taunt.png": "rbxassetid://140374029101007",
	"fx-ambient-b1.png": "rbxassetid://131103819510854",
	"fx-ambient-b2.png": "rbxassetid://113130535213244",
	"fx-ambient-b3.png": "rbxassetid://81069724717150",
	"fx-ambient-b5.png": "rbxassetid://93348383001922",
	"fx-effects.png": "rbxassetid://92741658775036",
	"warbanner-attack-outline.png": "rbxassetid://140066719502270",
	"warbanner-attack.png": "rbxassetid://107477792134015",
	"warbanner-body-outline.png": "rbxassetid://99626414064159",
	"warbanner-body.png": "rbxassetid://125690549403530",
	"warbanner-death-outline.png": "rbxassetid://87407464541596",
	"warbanner-death.png": "rbxassetid://83864438929127",
};

/**
 * Uploaded sheets OLDER than their generated layout, by the ID pasted above: the uploaded image's size, pixels. Only a
 * sheet whose layout appends pieces without moving the older ones (the boon icons' `order`, art/atlases.json) may be
 * listed: the manifest then draws the pieces whose rect lies inside this size, at this size, and leaves out the rest
 * (they keep their fallback) until the new sheet is uploaded and its ID replaces the old one (delete the entry then).
 */
export const VALE_UPLOADED_SIZES: Readonly<Record<string, { readonly w: number; readonly h: number }>> = {
	// boon-icons.png, first upload (2026-11-08): the 17 boons before builds v2 wave 1; the sheet is 18 x 360 since
	// Riposte / Ballista / Wrecker were appended (docs/BUILDS_V2.md BV10). Upload art/upload/boon-icons.png again.
	"rbxassetid://120375465703784": { w: 18, h: 306 },
};
