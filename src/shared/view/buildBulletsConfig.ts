/**
 * Build effect bullets on screen (docs/BUILDS.md BU8): the trails behind burst / shard bolts and the ember floor
 * decals. Data only (buildBullets.ts applies them; BulletRenderController draws). Sizes in tiles or studs.
 */
export const BUILD_BULLET_VIEW = {
	/**
	 * A trail: one faint part behind the bolt along its velocity (pooled per bullet slot), this many tiles long, the
	 * bolt's width times widthScale, at this transparency. Only burst and shard bolts have one; buildFx Reduced and
	 * reduced motion draw none.
	 */
	trail: {
		lengthTiles: 0.45,
		widthScale: 0.6,
		transparency: 0.55,
		folderName: "KV_BulletTrails",
	},
	/**
	 * Embers (Fire Arrows / Blazing Trail): a flat disc of `bullet.player.ember` (build.ember) on the floor, the goo
	 * decal pool's construction. Below the goo (GOO_VIEW lift 0.08: a hazard always shows over the player's own
	 * flame), under every marking (0.16) and every moving bullet.
	 */
	ember: {
		/** The decal look on (false draws embers as ordinary player bolts: the fallback). */
		decal: true,
		diameterTiles: 0.5,
		popSec: 0.08,
		fadeSec: 0.3,
		thicknessStuds: 0.025,
		liftStuds: 0.045,
		quantum: 0.1,
		folderName: "KV_Embers",
	},
} as const;
