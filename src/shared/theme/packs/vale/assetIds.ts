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
 */
import type { RobloxAssetId } from "../../types";

/**
 * Uploaded 2026-10-25 by k9kbdev (Studio Asset Manager, Bulk Import), transcribed from Asset Manager screenshots.
 * vanguard-attack3.png's ID is by elimination: it was the only remaining truncated "vanguard-atta..." row.
 */
export const VALE_ASSET_IDS: Readonly<Record<string, RobloxAssetId>> = {
	// swarmer-move.png / swarmer-death.png: the 2026-10-25 IDs were removed. They hold the old 940x910 atlases (94x70
	// cells); the outline pad change (plan O3: 98x74 cells, 980x962) would cut them at the wrong cells. Re-upload both
	// from art/build/ together with swarmer-move-outline.png and swarmer-death-outline.png and paste all four here
	// (plan O5); until then enemy.swarmer draws its placeholder ball (outlined by the shared Highlight).
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
