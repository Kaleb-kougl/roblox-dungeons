/**
 * Engine content textures for the PA0 sprite-bullet spike (docs/PROJECTILE_ART.md PA0, docs/SPIKES.md "Spike PA0"),
 * used only while `ThemePack.bullet("bullet.player.basic")` has no art. They ship inside every Roblox install
 * (`content/textures/particles/`: the default ParticleEmitter, Fire and Smoke textures), so the spike needs no upload.
 * They live here because asset URLs may only appear in shared/theme (scripts/check-asset-ids.js). Spike only: no game
 * code reads them.
 */
export const SPIKE_ENGINE_TEXTURES = {
	/**
	 * Option (A)'s flipbook: three separate textures, one per frame (a Decal cannot crop a rect), swapped through
	 * `Decal.Texture`.
	 */
	decalFrames: [
		"rbxasset://textures/particles/sparkles_main.dds",
		"rbxasset://textures/particles/fire_main.dds",
		"rbxasset://textures/particles/smoke_main.dds",
	],
	/**
	 * Options (B) and (C): one texture read as a horizontal 3-cell strip through ImageRectOffset / ImageRectSize
	 * (its assumed pixel size: BULLET_SPIKE.sprite.fallbackStripPx in shared/config spikes.ts).
	 */
	strip: "rbxasset://textures/particles/sparkles_main.dds",
} as const;
