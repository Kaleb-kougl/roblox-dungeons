/**
 * The tutorial's HUD and world-marker presentation (docs/TUTORIAL.md §4; a Roblox-port feature, no web source): layout
 * tunables of the TutorialPanel / ObjectiveCard / TutorialOutro, the pulsing highlight ring, the ghost half heart,
 * the world marker's bob and the guidance arrow's tunables, slide, chevron geometry and on-screen test
 * (docs/TUTORIAL_ARROW.md; the pause overlay's tutorial buttons are shared/view/menu `pauseItems`). Plain numbers,
 * headlessly tested (tutorialHud.spec.ts); client/ui/hud, TutorialMarkerController and TutorialArrowController draw
 * them.
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
	/** On touch (docs/MOBILE.md MB10): the prompt's width at the top centre, under the boss bar (footprint.ts). */
	touchPanelWidth: 360,
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
	/**
	 * Guidance arrow (docs/TUTORIAL_ARROW.md; TutorialArrowController draws it, shared/tutorial TutorialGuide decides
	 * where it points): a flat chevron on the floor in `arrowRole`, or the optional pack image `arrowImageId`
	 * (placeholder pack: none, two thin Parts). Starting values for the playtest (A6).
	 */
	arrowRole: "uiAccent" as ColorRole,
	arrowImageId: "ui.arrow.tutorial",
	/** It lies this far from the player's feet along its heading (tiles, centre to centre). */
	arrowOrbitTiles: 1.6,
	/** Chevron size (tiles): tip to tail along the heading, across the two arms, and each arm's bar thickness. */
	arrowLengthTiles: 0.7,
	arrowWidthTiles: 0.6,
	arrowBarTiles: 0.12,
	/** Hidden when the target is this close along the path (BFS tiles): the beam is right there. */
	arrowHideTiles: 3,
	/** It aims at the farthest tile with a clear walk among this many tiles of the path ahead (string pulling). */
	arrowLookaheadTiles: 8,
	/** A moving target (Mother Bramble) rebuilds the path field at most this often (seconds), and only on a new tile. */
	arrowFieldSeconds: 0.25,
	/** Heading damping time constant (seconds; turns the shortest way). */
	arrowTurnTau: 0.1,
	/** Fade in / out over this long (seconds, alpha 0 <-> 1). */
	arrowFadeSeconds: 0.2,
	/** A change of the show rule takes effect only after holding this long (seconds), so it never flickers. */
	arrowHoldSeconds: 0.3,
	/** Forward slide along its heading (tiles) once per period (seconds; scaled by motionScale, none under reduced motion). */
	arrowSlideTiles: 0.15,
	arrowPeriodSeconds: 1.2,
	/** Its transparency when fully shown (alpha 1). */
	arrowTransparency: 0.1,
	/** "Target on screen" (it hides with a clear way to it) needs the target this far (viewport fraction) inside every edge. */
	arrowScreenInset: 0.08,
	/**
	 * Height: its centre sits this fraction of MARKING_VIEW.liftTiles above the floor and each of its Parts is
	 * arrowThicknessStuds thick, so it lies on the floor but under the telegraph / weapon markings (their dashes start
	 * at the full lift) and the bullets.
	 */
	arrowLiftFraction: 0.5,
	arrowThicknessStuds: 0.04,
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

/** The guidance arrow at time `t`: its forward slide (tiles, along its heading) and transparency. */
export interface ArrowLook {
	readonly slideTiles: number;
	readonly transparency: number;
}

/**
 * The guidance arrow at time `t` (seconds; any clock) scaled by the juice motionScale (1 normal, 0 reduced motion;
 * clamped to 0..1) and faded by `alpha` (TutorialGuide's GuideView.alpha; clamped to 0..1, 0 = invisible): it slides
 * forward by up to arrowSlideTiles and back once per arrowPeriodSeconds (motion 0: still at 0), and its transparency
 * goes from arrowTransparency at alpha 1 to 1 at alpha 0.
 */
export function tutorialArrowLook(t: number, motion: number, alpha = 1): ArrowLook {
	const v = TUTORIAL_VIEW;
	const m = math.clamp(motion, 0, 1);
	const a = math.clamp(alpha, 0, 1);
	return {
		slideTiles: v.arrowSlideTiles * pulse01(t, v.arrowPeriodSeconds) * m,
		transparency: v.arrowTransparency + (1 - v.arrowTransparency) * (1 - a),
	};
}

/**
 * One arm of the placeholder chevron (the +x one; the other mirrors it: -centreAcrossTiles, -yaw), in the arrow's
 * frame: x across the heading, z along it (tip ahead), origin at the chevron's centre. The arm runs from the tail
 * corner (widthTiles / 2, -lengthTiles / 2) to the tip (0, lengthTiles / 2); a Part `lengthTiles` long on its own z
 * axis, turned by CFrame.Angles(0, yaw, 0), lies along it.
 */
export interface ArrowArm {
	/** Tail corner to tip (tiles). */
	readonly lengthTiles: number;
	/** The arm's midpoint across the heading (tiles; along the heading it is 0). */
	readonly centreAcrossTiles: number;
	/** Turn about the up axis from the heading to the arm (radians; the shared heading convention, (sin, cos)). */
	readonly yaw: number;
}

export function tutorialArrowArm(
	lengthTiles: number = TUTORIAL_VIEW.arrowLengthTiles,
	widthTiles: number = TUTORIAL_VIEW.arrowWidthTiles,
): ArrowArm {
	const across = -widthTiles * HALF;
	return {
		lengthTiles: math.sqrt(across * across + lengthTiles * lengthTiles),
		centreAcrossTiles: widthTiles * HALF * HALF,
		yaw: math.atan2(across, lengthTiles),
	};
}

/**
 * The `ui.arrow.tutorial` image laid flat on the floor (tiles: [across the heading, along it]): the image's pixel
 * aspect, as large as fits in arrowWidthTiles x arrowLengthTiles (its top edge points along the heading). Not stretched
 * by 1 / sin(pitch) like the camera-yawed co-op ring, because it turns with the heading.
 */
export function tutorialArrowImageSize(wPx: number, hPx: number): readonly [number, number] {
	const v = TUTORIAL_VIEW;
	if (!(wPx > 0) || !(hPx > 0)) return [v.arrowWidthTiles, v.arrowLengthTiles];
	const s = math.min(v.arrowWidthTiles / wPx, v.arrowLengthTiles / hPx);
	return [wPx * s, hPx * s];
}

/**
 * "The target is on screen" for TutorialGuide: a viewport point (Camera:WorldToViewportPoint's x, y in pixels and z,
 * the depth in front of the camera) of a `viewW` x `viewH` viewport is in front of the camera and at least `inset`
 * (a fraction of each dimension) inside every edge. NaN or a degenerate viewport: false.
 */
export function tutorialArrowOnScreen(
	x: number,
	y: number,
	depth: number,
	viewW: number,
	viewH: number,
	inset: number = TUTORIAL_VIEW.arrowScreenInset,
): boolean {
	if (!(depth > 0) || !(viewW > 0) || !(viewH > 0)) return false;
	const mx = viewW * inset;
	const my = viewH * inset;
	return x >= mx && x <= viewW - mx && y >= my && y <= viewH - my;
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
