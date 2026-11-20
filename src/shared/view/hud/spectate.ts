/**
 * The co-op spectate bar (docs/SPECTATE.md S5; client/ui/hud SpectateBar): its theme string keys, layout, colour
 * roles, fade-in and line rules. Roblox-port feature, no web source. Pure, checked headlessly (spectateHud.spec.ts).
 * The switch keys follow the player's bindings (shared/play spectateHint); the snapshot fields it reads come from
 * shared/play takeSnapshot (`spectating`, `spectateName`, `spectatePosition`, `spectateCount`).
 *
 * @module
 */
import type { ColorRole, SliceInsets } from "shared/theme";
import { snappedSliceScale, type SkinBox } from "./skin";
import { UI_ART } from "./skinConfig";

export const SPECTATE_HUD_STRINGS = {
	/** "Spectating {name}  ·  {pos} / {count}". */
	watching: "hud.spectate.watching",
	/** "Spectating {name}": no position to show (the hold on the watched player's corpse, a wipe). */
	watchingName: "hud.spectate.watchingName",
	/** "{next} next · {previous} previous" (the player's Attack / Alt bindings on the last-used device). */
	hint: "hud.spectate.hint",
	back: "hud.spectate.back",
} as const;

/** Every string key the spectate bar reads (spectateHud.spec.ts checks they exist in the placeholder pack). */
export function spectateStringKeys(): string[] {
	const out: string[] = [];
	for (const [, key] of pairs(SPECTATE_HUD_STRINGS as unknown as Map<string, string>)) out.push(key);
	return out;
}

/** Layout (reference pixels), colour roles and timing of the spectate bar (bottom centre). */
export const SPECTATE_BAR_VIEW = {
	width: 420,
	/** Gap from the bottom of the safe area. */
	bottom: 40,
	nameRole: "uiAccent" as ColorRole,
	hintRole: "uiText" as ColorRole,
	backRole: "uiTextDim" as ColorRole,
	/** Seconds the bar takes to fade in (instant under reduced motion). */
	fadeSec: 0.3,
	/** The switch hint shows with at least this many living teammates to switch between. */
	hintMinCount: 2,
	/** Reference px kept between the ghost and the frame's top and bottom rails. */
	ghostGap: 2,
} as const;

/**
 * The ghost's box beside the bar's lines (docs/UI_ART.md UA8), reference px: square, as tall as the bar's height
 * (`barHeight`, reference px, measured: it has two or three lines, and translations wrap) inside its frame's rails
 * (`insets`, art px, at the hud frames' snapped SliceScale under `uiScale`) less SPECTATE_BAR_VIEW.ghostGap each side,
 * capped at UI_ART.iconBox.ghost; never negative. The client fits the art into it with fitArtWithin, so the ghost stays
 * inside the bar on every screen size.
 */
export function spectateGhostBox(
	barHeight: number,
	insets: Readonly<SliceInsets> | undefined,
	uiScale: number,
): SkinBox {
	const slice = snappedSliceScale(uiScale, UI_ART.hudRefPerArt);
	const rails = insets !== undefined ? (insets.top + insets.bottom) * slice : 0;
	const room = barHeight - rails - 2 * SPECTATE_BAR_VIEW.ghostGap;
	const side = math.clamp(room, 0, UI_ART.iconBox.ghost);
	return { w: side, h: side };
}

/** The name line's key: with the "pos / count" part only while the watched player is one of the living ones. */
export function spectateWatchingKey(position: number): string {
	return position > 0 ? SPECTATE_HUD_STRINGS.watching : SPECTATE_HUD_STRINGS.watchingName;
}

/**
 * The switch hint shows: the watched player is one of the living ones (`position` > 0; 0 during the hold on a
 * corpse, when presses are ignored) and there is more than one to switch between.
 */
export function spectateHintShown(position: number, count: number): boolean {
	return position > 0 && count >= SPECTATE_BAR_VIEW.hintMinCount;
}

/**
 * The bar's GroupTransparency `age` seconds after it appeared: 1 -> 0 over SPECTATE_BAR_VIEW.fadeSec, scaled by the
 * juice motionScale (0, reduced motion: shown at once).
 */
export function spectateBarTransparency(age: number, motion: number): number {
	const fade = SPECTATE_BAR_VIEW.fadeSec * motion;
	if (fade <= 0 || age >= fade) return 0;
	if (!(age > 0)) return 1;
	return 1 - age / fade;
}
