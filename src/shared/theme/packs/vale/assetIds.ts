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
 * (vanguard-attack1..3.png) join when their IDs are added. An enemy sheet's outline (swarmer-move-outline.png,
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
 * decor-atlas.png and decor-mote.png uploaded 2026-10-26 (docs/DECOR.md R5); that batch also re-uploaded the 13 files
 * above as duplicates with new IDs, which are not used (the images are byte-identical to the ones listed here).
 * swarmer-move.png / swarmer-death.png re-uploaded 2026-10-26 9:25 after the enemy-outline pad change (docs/OUTLINE.md
 * O3: 98x74 cells, 980x962 atlases), with swarmer-move-outline.png / swarmer-death-outline.png (O5). The two outline
 * names were truncated in Asset Manager ("swarmer-deat...", "swarmer-mov..."); each is the only file left with that prefix.
 * sniper-idle.png / sniper-idle-outline.png uploaded 2026-10-26 1:16 PM by k9kbdev (docs/SNIPER_ART.md SN6: 126x93
 * cells, 1008x744 atlas), transcribed from an Asset Manager screenshot.
 * Audio: 38 of the 54 art/build/audio/*.ogg files uploaded 2026-10-26 11:08 by k9kbdev (Asset Manager Bulk Import,
 * built by audio:build with ffmpeg 6.1.1), transcribed from Asset Manager screenshots. Not yet here: amb-b1, the nine
 * music-*.ogg, sfx-depth-up, sfx-enemy-hurt-3 / -4 / -6, sfx-enemy-telegraph, sfx-player-shoot, sfx-stairwell-open.
 */
export const VALE_ASSET_IDS: Readonly<Record<string, RobloxAssetId>> = {
	"amb-b3.ogg": "rbxassetid://123793639672129",
	"amb-b4.ogg": "rbxassetid://106702179717675",
	"amb-b5.ogg": "rbxassetid://113010219687537",
	"decor-atlas.png": "rbxassetid://107968620179940",
	"decor-mote.png": "rbxassetid://108281638823690",
	"sfx-boss-death.ogg": "rbxassetid://98231076745245",
	"sfx-boss-roar.ogg": "rbxassetid://103385650363670",
	"sfx-breakable-break.ogg": "rbxassetid://116444193017210",
	"sfx-breakable-hit.ogg": "rbxassetid://77751477617243",
	"sfx-ember.ogg": "rbxassetid://132331997932373",
	"sfx-enemy-death-1.ogg": "rbxassetid://120112698995155",
	"sfx-enemy-death-2.ogg": "rbxassetid://139105704609425",
	"sfx-enemy-death-3.ogg": "rbxassetid://100811224100190",
	"sfx-enemy-hurt-1.ogg": "rbxassetid://92848072200948",
	"sfx-enemy-hurt-2.ogg": "rbxassetid://72455668388301",
	"sfx-enemy-hurt-5.ogg": "rbxassetid://116770794061890",
	"sfx-enemy-shoot.ogg": "rbxassetid://117798043671657",
	"sfx-floor-enter.ogg": "rbxassetid://136963659016362",
	"sfx-jingle-gameover.ogg": "rbxassetid://100204013637893",
	"sfx-player-charged.ogg": "rbxassetid://134000846415949",
	"sfx-player-death.ogg": "rbxassetid://116272723028955",
	"sfx-player-deflect.ogg": "rbxassetid://111196234749460",
	"sfx-player-finisher.ogg": "rbxassetid://126253596804652",
	"sfx-player-flask.ogg": "rbxassetid://132402914407938",
	"sfx-player-hurt.ogg": "rbxassetid://109847922628008",
	"sfx-player-roll.ogg": "rbxassetid://73804106008724",
	"sfx-player-swap.ogg": "rbxassetid://88978044362008",
	"sfx-player-swing-1.ogg": "rbxassetid://81803616082630",
	"sfx-player-swing-2.ogg": "rbxassetid://120871115343244",
	"sfx-player-swing-3.ogg": "rbxassetid://77155197597647",
	"sfx-player-swing-4.ogg": "rbxassetid://123568922754251",
	"sfx-player-swing-5.ogg": "rbxassetid://119336453391941",
	"sfx-relic-take.ogg": "rbxassetid://117702527882611",
	"sfx-room-clear.ogg": "rbxassetid://91705259787657",
	"sfx-shrine-use.ogg": "rbxassetid://116463287240842",
	"sfx-ui-back.ogg": "rbxassetid://97552556590703",
	"sfx-ui-click.ogg": "rbxassetid://81382073811691",
	"sfx-ui-confirm.ogg": "rbxassetid://129583273016065",
	"sfx-ui-move.ogg": "rbxassetid://98968775960499",
	"sfx-victory.ogg": "rbxassetid://138562382025197",
	"sniper-idle-outline.png": "rbxassetid://72531972026139",
	"sniper-idle.png": "rbxassetid://136813347348140",
	"swarmer-death-outline.png": "rbxassetid://72521271467524",
	"swarmer-death.png": "rbxassetid://101974921579587",
	"swarmer-move-outline.png": "rbxassetid://71928565662655",
	"swarmer-move.png": "rbxassetid://123202950556458",
	"tile-biome1-floor.png": "rbxassetid://98164459682194",
	"ui-marker-pedestal.png": "rbxassetid://126528421886645",
	"ui-ring-player.png": "rbxassetid://111980900819302",
	"vanguard-attack1.png": "rbxassetid://132423462677316",
	"vanguard-attack2.png": "rbxassetid://139632320163472",
	"vanguard-attack3.png": "rbxassetid://81872310850391",
	"vanguard-death.png": "rbxassetid://138909624937484",
	"vanguard-hit.png": "rbxassetid://127829250065405",
	"vanguard-idle.png": "rbxassetid://126099595216301",
	"vanguard-roll.png": "rbxassetid://113453153969851",
	"vanguard-run.png": "rbxassetid://98583531315344",
};
