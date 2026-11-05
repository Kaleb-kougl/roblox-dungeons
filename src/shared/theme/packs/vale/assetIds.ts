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
 * -taunt.png, plus one -outline.png per sheet (14 files). An enemy sheet's outline (swarmer-move-outline.png,
 * swarmer-death-outline.png) adds the baked rim once its ID is here; without it the set still switches, rimless.
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
 * stormcaller-* are uploaded too, but which of the two stormcaller-body ids is the outline is not known yet (attack
 * 98689179931162 / outline 113129536919777, death 117013780053629 / outline 123020171014128 are), so its set stays a
 * placeholder until that pair is read.
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
	"boost-aegis.png": "rbxassetid://140457804095686",
	"boost-frenzy.png": "rbxassetid://123942115924560",
	"boost-fury.png": "rbxassetid://81008876085390",
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
	"decor-mote.png": "rbxassetid://108281638823690",
	"imp-attack-outline.png": "rbxassetid://87826495349638",
	"imp-attack.png": "rbxassetid://106802821695726",
	"imp-body-outline.png": "rbxassetid://80038327609999",
	"imp-body.png": "rbxassetid://130645679779456",
	"imp-death-outline.png": "rbxassetid://134104614361499",
	"imp-death.png": "rbxassetid://84336726009588",
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
	"pellet-power.png": "rbxassetid://135982735087293",
	"pellet.png": "rbxassetid://104506728931703",
	"reaper-attack-outline.png": "rbxassetid://95992799302634",
	"reaper-attack.png": "rbxassetid://81078161742843",
	"reaper-body-outline.png": "rbxassetid://130853749528261",
	"reaper-body.png": "rbxassetid://75857827785103",
	"reaper-death-outline.png": "rbxassetid://138125634876332",
	"reaper-death.png": "rbxassetid://117603043827937",
	"sfx-affix-shieldbreak.ogg": "rbxassetid://116871435989650",
	"sfx-affix-vengeful.ogg": "rbxassetid://122645585698044",
	"sfx-best-new.ogg": "rbxassetid://139947943484777",
	"sfx-boss-death.ogg": "rbxassetid://98231076745245",
	"sfx-boss-roar.ogg": "rbxassetid://103385650363670",
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
	"sfx-pellet-power.ogg": "rbxassetid://119476079306502",
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
	"sfx-player-syncparry.ogg": "rbxassetid://84948565537343",
	"sfx-rank-up.ogg": "rbxassetid://72950951266263",
	"sfx-relic-take.ogg": "rbxassetid://117702527882611",
	"sfx-room-clear.ogg": "rbxassetid://91705259787657",
	"sfx-room-perfect.ogg": "rbxassetid://126017159048037",
	"sfx-room-teamperfect.ogg": "rbxassetid://82497842436869",
	"sfx-score-land.ogg": "rbxassetid://77069986772456",
	"sfx-score-tick.ogg": "rbxassetid://117631758592807",
	"sfx-shrine-use.ogg": "rbxassetid://116463287240842",
	"sfx-stairwell-open.ogg": "rbxassetid://85934761619292",
	"sfx-ui-back.ogg": "rbxassetid://97552556590703",
	"sfx-ui-click.ogg": "rbxassetid://81382073811691",
	"sfx-ui-confirm.ogg": "rbxassetid://129583273016065",
	"sfx-ui-move.ogg": "rbxassetid://98968775960499",
	"sfx-victory.ogg": "rbxassetid://138562382025197",
	"slime-body-outline.png": "rbxassetid://125641170965641",
	"slime-body.png": "rbxassetid://105955364807363",
	"sniper-idle-outline.png": "rbxassetid://72531972026139",
	"sniper-idle.png": "rbxassetid://136813347348140",
	"sprayer-body-outline.png": "rbxassetid://113789975034893",
	"sprayer-body.png": "rbxassetid://91705891235798",
	"sprayer-death-outline.png": "rbxassetid://84907988039450",
	"sprayer-death.png": "rbxassetid://103488605375534",
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
	"ui-bar-fill.png": "rbxassetid://77055366404694",
	"ui-bar-track.png": "rbxassetid://102111490052610",
	"ui-button-disabled.png": "rbxassetid://127150562683800",
	"ui-button-focus.png": "rbxassetid://123935262412449",
	"ui-button.png": "rbxassetid://107732705819497",
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
