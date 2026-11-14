/**
 * Roblox port (docs/SECRET_ROOMS.md SR10): the secret rooms' optional world art rule, in its own module like
 * cursorArt.ts (validate.ts and contract.ts sit near Luau's 200-locals-per-function limit): `secretArtProblems` is
 * folded into variantColors.ts' `variantColorProblems`, so validate.ts takes no new name.
 *
 *   - `secret.crack` / `secret.rubble` (secrets.ts SECRET_ART_IDS, slot `secret`, OPTIONAL, no placeholder entry): the
 *     generic world art checks (validate.ts: an uploaded image with `pixelsPerTile`, or a sprites set with `idle`)
 *     apply; a `sprites` set must have ONE facing: the crack lies on a wall face and the rubble flat on two cells, both
 *     drawn as they are whatever the camera's turn (the view places them on the wall's own axes). Validate.ts refuses
 *     any other `secret.` ID.
 */

import { SECRET_ART_IDS } from "./secrets";
import { isObj } from "./util";

/** A validator message: where (a manifest path) and what. */
export interface SecretArtProblem {
	path: Array<string>;
	msg: string;
}

/** The one-facing rule (variantColorProblems adds them; path `assets.<id>.facings`). Nothing for a pack without the art. */
export function secretArtProblems(manifest: unknown): Array<SecretArtProblem> {
	const out = new Array<SecretArtProblem>();
	const assets = isObj(manifest) && isObj(manifest.assets) ? manifest.assets : undefined;
	if (assets === undefined) {
		return out;
	}
	for (const id of SECRET_ART_IDS) {
		const def = assets[id];
		if (!isObj(def) || def.kind !== "sprites") {
			continue;
		}
		const facings = isObj(def.facings) ? def.facings.count : undefined;
		if (facings !== 1) {
			out.push({
				path: ["assets", id, "facings"],
				msg: `a secret room's art has one facing (count 1), got ${tostring(
					facings,
				)}: the view lays it on the wall's own axes`,
			});
		}
	}
	return out;
}
