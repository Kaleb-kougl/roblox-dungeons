/**
 * Sword spacing tunables (docs/SWORD_SPACING.md Design 1-2, 6, SPD5 / SPD8; a Roblox-port feature, no web source).
 * Data only: ./spacing.ts and ./spacingBrake.ts read it, nothing is inline in the logic. A LEAF (no imports).
 *
 * @module
 */

/** How the Knight's walk and lunge are braked short of contact enemies (docs/SWORD_SPACING.md Design 2). */
export interface SpacingConfig {
	/** Extra distance past contact range, tiles. */
	readonly marginTiles: number;
	/** Cosine of the stop cone's half-angle (25 degrees), a literal: no trig in the sim. */
	readonly stopConeCos: number;
	/** Brake the sword's walk while attacking. */
	readonly walk: boolean;
	/** Brake the finisher's lunge. */
	readonly lunge: boolean;
}

/**
 * The live tuning: margin 0.15 tiles (SPD5), a 25-degree stop cone (SPD8: wider than a key's worst 22.5 degrees off
 * an enemy). `stopConeCos` is cos(25 degrees) written out (Math.cos(25 * Math.PI / 180) in V8).
 */
export const SWORD_SPACING: SpacingConfig = {
	marginTiles: 0.15,
	stopConeCos: 0.9063077870366499,
	walk: true,
	lunge: true,
};
