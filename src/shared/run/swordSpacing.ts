/**
 * The sword spacing brake for every world's SimConfig (docs/SWORD_SPACING.md Design 6, SPD6; a Roblox-port retune, no
 * web source): `SWORD_SPACING` in every live world, M1 included; none (the web build's sword) only as
 * `SwordSpacing.WEB`, which the parity specs set next to `setPlayerMover(PlayerMover.WEB)` /
 * `setSwordTimings(WEB_SWORD_TIMINGS)` so the golden fixtures still replay bit for bit. Read when a config is built
 * (buildRunConfig, buildEndlessRunConfig, the tutorial), like ./playerMover.ts. Pure and Roblox-API-free.
 *
 * @module
 */
import { SWORD_SPACING, type SpacingConfig } from "shared/sim";

/** Which brake `swordSpacing` gives (setSwordSpacing; specs only). */
export const SwordSpacing = {
	/** The port's sword (the default): SWORD_SPACING, the walk and the lunge braked short of contact enemies. */
	ON: 0,
	/** The web build's sword: no brake (SimConfig.spacing absent). What every golden fixture was recorded with. */
	WEB: 1,
} as const;
/**
 * A value of `SwordSpacing`: which brake `swordSpacing` gives. Specs pass it to `setSwordSpacing`; live code never sets
 * it.
 */
export type SwordSpacingKind = (typeof SwordSpacing)[keyof typeof SwordSpacing];

let currentKind: SwordSpacingKind = SwordSpacing.ON;

/**
 * Specs only: sets the brake `swordSpacing` gives (e.g. SwordSpacing.WEB for a golden replay) and returns the previous
 * kind to restore. It is read when a config is built, so set it before building the config you replay.
 */
export function setSwordSpacing(kind: SwordSpacingKind): SwordSpacingKind {
	const previous = currentKind;
	currentKind = kind;
	return previous;
}

/** The kind `swordSpacing` gives by default (SwordSpacing.ON unless a spec set another). */
export function swordSpacingKind(): SwordSpacingKind {
	return currentKind;
}

/** `SimConfig.spacing` of a run: SWORD_SPACING (ON, the default) or undefined (WEB: no brake). */
export function swordSpacing(kind: SwordSpacingKind = currentKind): SpacingConfig | undefined {
	return kind === SwordSpacing.WEB ? undefined : SWORD_SPACING;
}
