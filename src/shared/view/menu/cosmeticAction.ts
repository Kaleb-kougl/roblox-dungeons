/**
 * The Armory preview acting a cosmetic out (docs/COSMETICS.md "Preview actions"): a trail item rolls with the in-run
 * afterimages, a spark item attacks and throws the in-run parry burst; every other item keeps the turning idle. Pure:
 * the client's CharacterPreview draws what these return. Every number is the in-run one (FEEL_GHOST,
 * NEAR_MISS_VIEW.parry) except the preview's own staging in COSMETIC_VIEW.preview.action.
 *
 * A cycle is `restSec` of idle, then the action's animation once (its last frame held to the end of its length). A roll
 * slides across the box and alternates direction each cycle (right, then left), so the character never jumps back;
 * its ghosts are recorded every FEEL_GHOST.everyTicks sim ticks of the roll, at the sprite's position and frame then,
 * and fade from FEEL_GHOST.startTransparency to 1 over FEEL_GHOST.lifeSec (at most FEEL_GHOST.perSource alive). An
 * attack faces `attackAngleDeg`; at `sparkAtShare` of it a burst of NEAR_MISS_VIEW.parry.sparkCount sparks fans out
 * along the facing (half-angle fanRad, speeds sparkSpeedMin..Max with exponential drag) and a ring grows ringR0 ->
 * ringR1 tiles, all fading after `hold` of lifeSec; the preview stages it bigger and slower (spreadScale, burstSlowdown,
 * the client's sparkPx). Reduced motion: no action (the caller keeps the still idle).
 *
 * @module
 */
import { cosmeticItem, LOOK_SLOTS } from "shared/cosmetics";
import { COSMETIC_VIEW } from "../cosmetics/config";
import { FEEL_GHOST } from "../fx/motionFxConfig";
import { NEAR_MISS_VIEW } from "../fx/nearMissConfig";

const A = COSMETIC_VIEW.preview.action;
const P = NEAR_MISS_VIEW.parry;
const SIM_HZ = 60;
const DEG = math.pi / 180;
const HALF = 0.5;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;
/** A spark's speed between sparkSpeedMin and Max: the fractional golden-ratio sequence (spread, no rng). */
const SPREAD_STEP = 0.618034;

export type PreviewAction = "idle" | "roll" | "attack";

/** The action the preview plays for item `itemId`: a trail rolls, a spark attacks, anything else idles. */
export function cosmeticPreviewAction(itemId: string | undefined): PreviewAction {
	const it = cosmeticItem(itemId);
	if (it === undefined) return "idle";
	if (it.slot === LOOK_SLOTS.trail) return "roll";
	if (it.slot === LOOK_SLOTS.spark) return "attack";
	return "idle";
}

/**
 * The animation names an action may play, first found wins: the theme's names (art/atlases.json), `attack.1` being the
 * Knight's swing (Melee) and the Archer's quick shot; `attack` for a set with one attack. cosmeticAction.spec checks both
 * vale characters resolve each action (a wrong name would fall back to the idle silently).
 */
export const PREVIEW_ACTION_ANIMS: Readonly<Record<"roll" | "attack", ReadonlyArray<string>>> = {
	roll: ["roll"],
	attack: ["attack.1", "attack"],
};

/** The animation `action` plays on a set that `has` these names, or undefined (idle, or none of them). */
export function previewActionAnim(action: PreviewAction, has: (anim: string) => boolean): string | undefined {
	if (action === "idle") return undefined;
	for (const anim of PREVIEW_ACTION_ANIMS[action]) if (has(anim)) return anim;
	return undefined;
}

/** Where a cycle is at `tSec`: resting (idle) or acting, `actSec` into the action. */
export interface PreviewActionPhase {
	readonly acting: boolean;
	/** Seconds into the action (0 while resting). */
	readonly actSec: number;
	/** The action's frame (its last held once the animation has played). */
	readonly frame: number;
	/** The cycle's index (0 first): a roll goes right on even cycles, left on odd ones. */
	readonly cycle: number;
}

/** The action's length: its frames at its fps (0 without either). */
export function previewActionSec(fps: number, frames: number): number {
	return fps > 0 && frames > 0 ? frames / fps : 0;
}

/** The cycle phase at `tSec` for an action of `frames` frames at `fps`. */
export function previewActionPhase(tSec: number, fps: number, frames: number): PreviewActionPhase {
	const act = previewActionSec(fps, frames);
	if (!(act > 0) || !(tSec > 0)) return { acting: false, actSec: 0, frame: 0, cycle: 0 };
	const period = A.restSec + act;
	const cycle = math.floor(tSec / period);
	const inCycle = tSec - cycle * period;
	if (inCycle < A.restSec) return { acting: false, actSec: 0, frame: 0, cycle };
	const actSec = inCycle - A.restSec;
	return { acting: true, actSec, frame: math.min(frames - 1, math.floor(actSec * fps)), cycle };
}

/** A roll's screen angle on `cycle`: 0 (right) on even cycles, 180 (left) on odd ones. */
export function previewRollAngleDeg(cycle: number): number {
	return cycle % 2 === 0 ? 0 : HALF_TURN_DEG;
}

/**
 * The roll's horizontal offset as a share of the box (+ right), `actSec` into a roll of `actLen` seconds on `cycle`:
 * from -slide / 2 to +slide / 2 (right) or back (left), eased out; at rest the end it came to.
 */
export function previewRollOffset(acting: boolean, actSec: number, actLen: number, cycle: number): number {
	const half = A.rollSlideShare * HALF;
	const right = cycle % 2 === 0;
	// at rest: where the previous roll ended (cycle 0 starts at the left, ready to roll right)
	if (!acting) return right ? -half : half;
	const p = actLen > 0 ? math.clamp(actSec / actLen, 0, 1) : 1;
	const eased = 1 - (1 - p) * (1 - p);
	const x = -half + 2 * half * eased;
	return right ? x : -x;
}

/** One roll ghost: when it was recorded (seconds into the roll), where (box share) and its transparency now. */
export interface PreviewGhost {
	readonly recordedSec: number;
	readonly offset: number;
	readonly transparency: number;
}

/**
 * The ghosts alive `actSec` into a roll of `actLen` seconds (or `restSec` into the rest after it, `acting` false): one
 * recorded every FEEL_GHOST.everyTicks / 60 s while rolling, the newest FEEL_GHOST.perSource of those still within
 * FEEL_GHOST.lifeSec, oldest first.
 */
export function previewGhosts(
	acting: boolean,
	actSec: number,
	actLen: number,
	cycle: number,
	sinceRollEndSec = 0,
): ReadonlyArray<PreviewGhost> {
	if (!(actLen > 0)) return [];
	const now = acting ? actSec : actLen + math.max(0, sinceRollEndSec);
	const every = FEEL_GHOST.everyTicks / SIM_HZ;
	const life = FEEL_GHOST.lifeSec;
	const out = new Array<PreviewGhost>();
	const last = math.floor(math.min(now, actLen) / every);
	const first = math.max(0, last - FEEL_GHOST.perSource + 1);
	for (let k = first; k <= last; k++) {
		const at = k * every;
		if (at >= actLen) continue;
		const age = now - at;
		if (age < 0 || age >= life) continue;
		const t0 = FEEL_GHOST.startTransparency;
		out.push({
			recordedSec: at,
			offset: previewRollOffset(true, at, actLen, cycle),
			transparency: t0 + (1 - t0) * (age / life),
		});
	}
	return out;
}

/** One spark of the burst: its position in tiles from the burst's origin (+x right, +y down), size and transparency. */
export interface PreviewSpark {
	readonly x: number;
	readonly y: number;
	/** Side in art px (sparkMinPx..sparkMaxPx). */
	readonly sizePx: number;
	readonly transparency: number;
}

/** The burst's ring: radius in tiles and transparency. */
export interface PreviewRing {
	readonly radius: number;
	readonly transparency: number;
}

export interface PreviewBurst {
	readonly sparks: ReadonlyArray<PreviewSpark>;
	readonly ring: PreviewRing;
}

/** The burst's life in the preview, seconds: the in-run lifeSec played burstSlowdown times slower. */
export function previewBurstSec(): number {
	return P.lifeSec * A.burstSlowdown;
}

/** A burst's transparency `age` seconds in: opaque for `hold` of its life, then linear to 1. */
function burstFade(age: number): number {
	const life = P.lifeSec;
	const held = P.hold * life;
	if (age <= held) return 0;
	return math.min(1, (age - held) / (life - held));
}

/**
 * The burst `actSec` into an attack of `actLen` seconds facing screen angle `angleDeg`, or undefined before it starts
 * (sparkAtShare of the attack) and once its life is over. Sparks: sparkCount, evenly over the fan (half-angle fanRad
 * around the facing), speeds spread sparkSpeedMin..Max, distance speed / drag x (1 - e^(-drag x age)).
 */
export function previewBurst(actSec: number, actLen: number, angleDeg: number): PreviewBurst | undefined {
	if (!(actLen > 0)) return undefined;
	// the in-run burst's age: the preview plays it burstSlowdown times slower
	const age = (actSec - A.sparkAtShare * actLen) / A.burstSlowdown;
	if (age < 0 || age >= P.lifeSec) return undefined;
	const fade = burstFade(age);
	const travel = (1 - math.exp(-P.drag * age)) / P.drag;
	const sparks = new Array<PreviewSpark>();
	const n = P.sparkCount;
	for (let i = 0; i < n; i++) {
		const share = n > 1 ? i / (n - 1) : HALF;
		const a = (angleDeg % FULL_TURN_DEG) * DEG + P.fanRad * (2 * share - 1);
		const spread = (i * SPREAD_STEP) % 1;
		const speed = P.sparkSpeedMin + (P.sparkSpeedMax - P.sparkSpeedMin) * spread;
		const d = speed * travel * A.spreadScale;
		sparks.push({
			x: math.cos(a) * d,
			y: -math.sin(a) * d,
			sizePx: spread < HALF ? P.sparkMinPx : P.sparkMaxPx,
			transparency: fade,
		});
	}
	const p = age / P.lifeSec;
	const eased = 1 - (1 - p) * (1 - p);
	return {
		sparks,
		ring: {
			radius: (P.ringR0Tiles + (P.ringR1Tiles - P.ringR0Tiles) * eased) * A.spreadScale,
			transparency: fade,
		},
	};
}

/**
 * The burst `tSec` into the preview for an attack of `frames` frames at `fps` facing `angleDeg`: it runs on into the
 * rest after the attack (the staged burst outlives the animation), never into the next attack (restSec is longer).
 */
export function previewBurstAt(tSec: number, fps: number, frames: number, angleDeg: number): PreviewBurst | undefined {
	const len = previewActionSec(fps, frames);
	const phase = previewActionPhase(tSec, fps, frames);
	if (phase.acting) return previewBurst(phase.actSec, len, angleDeg);
	if (phase.cycle === 0 || !(len > 0)) return undefined;
	const sinceEnd = tSec - phase.cycle * (A.restSec + len);
	return previewBurst(len + sinceEnd, len, angleDeg);
}

/** The burst's origin in tiles from the preview's centre (+x right, +y down): sparkReachTiles along the facing. */
export function previewBurstOrigin(angleDeg: number): { readonly x: number; readonly y: number } {
	const a = angleDeg * DEG;
	return { x: math.cos(a) * A.sparkReachTiles, y: -math.sin(a) * A.sparkReachTiles };
}
