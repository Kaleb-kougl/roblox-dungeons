/**
 * The tutorial's HUD and world-marker presentation (docs/TUTORIAL.md §4; a Roblox-port feature, no web source): layout
 * tunables of the TutorialPanel / ObjectiveCard / TutorialOutro, the pulsing highlight ring, the ghost half heart and
 * the world marker's bob (the pause overlay's tutorial buttons are shared/view/menu `pauseItems`). Plain numbers,
 * headlessly tested (tutorialHud.spec.ts); client/ui/hud and TutorialMarkerController draw them.
 */
import { DEFAULT_BINDINGS, actionLabel, inputLabel, leaderboardHint, type Bindings } from "shared/play";
import type { ColorRole } from "shared/theme";
import { PAUSE_HINT } from "./layout";

const TAU = math.pi * 2;
const HALF = 0.5;

/** Layout (reference pixels), timing (real seconds) and colour roles of the tutorial HUD and its world marker. */
export const TUTORIAL_VIEW = {
	/** TutorialPanel (lower centre): width, and its bottom edge this far above the safe area's bottom (clears the
	 * InfoPanel's lines at the bottom right and the WeaponPanel at the bottom left). */
	panelWidth: 480,
	panelBottom: 132,
	/** ObjectiveCard (centre) and the outro card (centre, menu layer). */
	cardWidth: 560,
	outroWidth: 560,
	outroButtonSize: { x: 300, y: 40 },
	/** Tutorial callout toasts (shared/tutorial TUTORIAL_CALLOUTS) stay this long; longer lines than progression toasts. */
	calloutSeconds: 5,
	/** Highlight ring (a UIStroke on the taught HUD element), colour role and pulse. */
	ringRole: "uiAccent" as ColorRole,
	ringThickness: 3,
	/** Extra thickness at the top of a pulse (scaled by motionScale; reduced motion: none). */
	ringPulseThickness: 2,
	/** Transparency at the bright and dim ends of a pulse (reduced motion: always the bright end). */
	ringTransparencyBright: 0,
	ringTransparencyDim: 0.6,
	ringPeriodSeconds: 1.1,
	/** The ghost half heart (a harmless hit): drawn in uiHealth and fading out over this long. */
	ghostHeartSeconds: 0.9,
	ghostHeartRole: "uiHealth" as ColorRole,
	/** Its transparency when it appears (it fades to 1). */
	ghostHeartStartTransparency: 0.15,
	/** World marker (TutorialMarkerController): an upright beam (a Cylinder) in `markerRole`, tiles. */
	markerRole: "uiAccent" as ColorRole,
	markerRadiusTiles: 0.12,
	markerHeightTiles: 2.5,
	/** It floats this far above the floor at rest, and bobs this far up and down (tiles; scaled by motionScale). */
	markerLiftTiles: 0.15,
	markerBobTiles: 0.25,
	markerPeriodSeconds: 1.6,
	/** Its transparency swings between these (reduced motion: the first). */
	markerTransparency: 0.15,
	markerTransparencyDim: 0.45,
	/** Optional theme image drawn as a camera-facing beam above the marker (placeholder pack: none, the Cylinder only). */
	markerImageId: "ui.marker.tutorial",
	markerImageHeightTiles: 3,
} as const;

/** What the highlight ring looks like at time `t` (seconds; any clock). */
export interface RingLook {
	readonly thickness: number;
	readonly transparency: number;
}

/** 0..1 pulse phase at `t` (0 at t = 0, 1 at half a period): a raised cosine. */
function pulse01(t: number, period: number): number {
	return HALF - HALF * math.cos((t / period) * TAU);
}

/**
 * The ring at time `t` scaled by the juice motionScale (1 normal, 0 reduced motion): it brightens and thickens once
 * per TUTORIAL_VIEW.ringPeriodSeconds; at motion 0 it is a static bright ring of the base thickness.
 */
export function highlightRingLook(t: number, motion: number): RingLook {
	const v = TUTORIAL_VIEW;
	const m = math.clamp(motion, 0, 1);
	const p = pulse01(t, v.ringPeriodSeconds) * m;
	return {
		thickness: v.ringThickness + v.ringPulseThickness * p,
		transparency: v.ringTransparencyBright + (v.ringTransparencyDim - v.ringTransparencyBright) * (m - p),
	};
}

/** The ghost half heart's transparency `age` seconds after it appeared (1 = gone). */
export function ghostHeartTransparency(age: number): number {
	const v = TUTORIAL_VIEW;
	if (!(age >= 0)) return v.ghostHeartStartTransparency;
	if (age >= v.ghostHeartSeconds) return 1;
	return v.ghostHeartStartTransparency + (1 - v.ghostHeartStartTransparency) * (age / v.ghostHeartSeconds);
}

/** The world marker at time `t`: its lift above the floor (tiles) and transparency, scaled by motionScale. */
export interface MarkerLook {
	readonly liftTiles: number;
	readonly transparency: number;
}

export function tutorialMarkerLook(t: number, motion: number): MarkerLook {
	const v = TUTORIAL_VIEW;
	const m = math.clamp(motion, 0, 1);
	const p = pulse01(t, v.markerPeriodSeconds) * m;
	return {
		liftTiles: v.markerLiftTiles + v.markerBobTiles * p,
		transparency: v.markerTransparency + (v.markerTransparencyDim - v.markerTransparency) * p,
	};
}

/** The pad's (fixed) move and aim sticks, as the gamepad prompts name them. */
const PAD_MOVE_INPUT = "Thumbstick1";

/**
 * The key names the tutorial prompts' templates read (`{move}`, `{fire}`, `{alt}`, `{roll}`, `{flask}`, `{swap}`,
 * `{ember}`, `{skill1}`, `{left}`, `{right}`), from the player's bindings (shared/play, Options > Controls) for the
 * HUD's last-used device, so a rebound key shows in every prompt. Keyboard: each action's primary input
 * (`{move}` = the four move keys, run together when each is one character: "WASD", else "Up / Left / Down / Right");
 * gamepad: the pad binding, `{move}` / `{left}` / `{right}` the fixed left stick. Touch prompts use the keyboard's.
 */
export function tutorialPromptVars(
	device: "keyboard" | "gamepad" | "touch",
	b: Bindings = DEFAULT_BINDINGS,
): Readonly<Record<string, string>> {
	if (device === "gamepad") {
		const stick = inputLabel(PAD_MOVE_INPUT);
		return {
			move: stick,
			left: stick,
			right: stick,
			fire: actionLabel(b, "pad", "fire"),
			alt: actionLabel(b, "pad", "alt"),
			roll: actionLabel(b, "pad", "roll"),
			flask: actionLabel(b, "pad", "flask"),
			swap: actionLabel(b, "pad", "swap"),
			ember: actionLabel(b, "pad", "ember"),
			skill1: actionLabel(b, "pad", "skill1"),
		};
	}
	const dirs = [
		actionLabel(b, "kbm", "moveUp"),
		actionLabel(b, "kbm", "moveLeft"),
		actionLabel(b, "kbm", "moveDown"),
		actionLabel(b, "kbm", "moveRight"),
	];
	let short = true;
	for (const d of dirs) if (d.size() !== 1) short = false;
	return {
		move: dirs.join(short ? "" : " / "),
		left: dirs[1],
		right: dirs[3],
		fire: actionLabel(b, "kbm", "fire"),
		alt: actionLabel(b, "kbm", "alt"),
		roll: actionLabel(b, "kbm", "roll"),
		flask: actionLabel(b, "kbm", "flask"),
		swap: actionLabel(b, "kbm", "swap"),
		ember: actionLabel(b, "kbm", "ember"),
		skill1: actionLabel(b, "kbm", "skill1"),
	};
}

/**
 * The outro's "{key}" (where the leaderboard opens), per device: the bound leaderboard key (default B), or the pad's
 * pause menu (Leaderboards).
 */
export function tutorialLeaderboardHint(b: Bindings = DEFAULT_BINDINGS): { keyboard: string; gamepad: string } {
	return { keyboard: leaderboardHint(b).keyboard, gamepad: PAUSE_HINT.gamepad };
}
