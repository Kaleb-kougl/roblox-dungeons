import { CAMERA_PITCH_DEG } from "shared/config";
import { STRIKE_BULLET_RADIUS } from "shared/sim";
import type { ColorRole } from "shared/theme";
import { BUILD_BULLET_VIEW } from "./buildBulletsConfig";

/**
 * The floor hazards' sprites (docs/HAZARD_ART.md HA4): the Stormcaller's strike (flash + the scorch it leaves) and the
 * build embers, drawn from greyscale art tinted by the hazard's colour role. Used only when the pack has the art
 * (ThemePack.hazardSprite); without it the decal discs (STRIKE_VIEW, BUILD_BULLET_VIEW.ember) exactly as before.
 */
export const HAZARD_ART_VIEW = {
	strike: {
		/** Every strike cell's tint (ImageColor3): the flash is danger, the scorch's char is dark by its own pixels. */
		role: "enemyBullet" as ColorRole,
		/** The hit circle the art's rim (`rimPx`) is mapped onto, tiles: the sim's strike radius. */
		hitRadius: STRIKE_BULLET_RADIUS,
		/** Variety without rng: the bullet slot's bits flip the top-down art along screen X / Y (every flip a valid strike). */
		flipXMask: 1,
		flipYMask: 2,
		folderName: "KV_StrikeSprites",
	},
	/** The scorch a strike leaves (HAD3): pure view state, harmless (the bullet is gone). Sim seconds. */
	scorch: {
		/** The hot cell (glowing cracks) for this long, then the cold one. */
		hotSec: 0.15,
		lifeSec: 0.8,
		/** It starts this transparent and fades to gone over its last fadeSec. */
		startTransparency: 0.15,
		fadeSec: 0.45,
		/** At most this many at once (the oldest is reused). */
		maxScorches: 16,
		/** Its top this far under the flash's (so a new strike draws over an old scorch). */
		belowFlashStuds: 0.002,
		/** Flips from the slot the strike came from (the flash's masks), shifted so a scorch differs from its flash. */
		seedShift: 1,
		folderName: "KV_Scorches",
	},
	ember: {
		/** Every ember cell's tint: the player's build colour (never the danger family: buildReport). */
		role: "build.ember" as ColorRole,
		/** The disc the burning patch (`lit`) covers on screen, tiles: the decal disc's radius. */
		coverRadius: BUILD_BULLET_VIEW.ember.diameterTiles / 2,
		/** The camera pitch the cover rule and the depth stretch use (the art is a 3/4 view, like the goo's). */
		cameraPitchDeg: CAMERA_PITCH_DEG,
		/** The slot's bit `mirrorMask` mirrors along screen X (never Y: the flame stands up). */
		mirrorMask: 1,
		/** Loop phase per slot, frames, so a trail of embers never flickers in step. */
		phaseStep: 2,
		folderName: "KV_EmberSprites",
	},
	/** Transparency write quantum (all three). */
	quantum: 0.05,
} as const;
