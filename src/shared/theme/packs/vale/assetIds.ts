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
 * (vanguard-attack1..3.png) join when their IDs are added. An image switches once its file has one. Re-upload (and paste the new ID) whenever `art:build` changes a PNG.
 *
 * Audio (art/README.md, "Audio"): `npm run audio:build` writes art/build/audio/*.ogg; paste each file's ID here the same
 * way ("sfx-player-hurt.ogg": "rbxassetid://<digits>"). A sound ID switches on once ALL of its files (its variants)
 * have IDs (audioLayout.ts lists them).
 */
import type { RobloxAssetId } from "../../types";

/**
 * Uploaded 2026-10-25 by k9kbdev (Studio Asset Manager, Bulk Import), transcribed from Asset Manager screenshots.
 * vanguard-attack3.png's ID is by elimination: it was the only remaining truncated "vanguard-atta..." row.
 */
export const VALE_ASSET_IDS: Readonly<Record<string, RobloxAssetId>> = {
	"swarmer-death.png": "rbxassetid://123002556658284",
	"swarmer-move.png": "rbxassetid://125033662723807",
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
