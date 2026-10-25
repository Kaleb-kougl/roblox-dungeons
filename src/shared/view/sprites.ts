/**
 * Sprite renderer logic (docs/ART.md S4), in plain numbers so it runs headlessly: the sim's world facing -> one of a
 * sprite set's screen facings, the animation and frame from sim state (the theme's SpriteSet.frame maps a frame to its
 * cell), the billboard's size and offset, floor / upright image sizes, the animation clock's step and the actor looks
 * (tints, blink, corpse fade) both render paths share. The client SpriteView only copies the results onto a
 * BillboardGui / ImageLabel. Presentation only: nothing here feeds `step()` (trig is fine).
 *
 * Facing. A SpriteSetAsset's facings are SCREEN directions (theme/types.ts: facing d points at zeroDeg + d * 360 /
 * count degrees, 0 = screen right, 90 = screen up). So the sim's ground facing is projected the way the camera
 * actually frames it: right component = g . right, up component = g . up (isoBasis), angle = atan2(up, right). That is
 * NOT the yaw-rotated ground angle: the pitch foreshortens the screen-up axis by sin(pitch), so at pitch 55 a world
 * diagonal relative to the camera shows at atan(sin 55) = 39.3 degrees from the screen's horizontal, not 45 (up to 5.7
 * degrees off, a quarter of a 16-facing bin). The true on-screen angle is the one the player reads: the mouse aim
 * points at the cursor on screen, and movement is seen as motion on screen. The camera's narrow FOV (7 degrees) makes
 * the perspective error negligible next to that.
 *
 * Animation. Choices follow a fixed priority, each rule skipped when the set lacks its animation (ending at idle):
 *   player: death > roll > attack (sword swings attack.1/2/3, else attack) > hit > run > idle
 *   actor:  death > attack > hit (multi-frame only; a 1-frame stand-in leaves it to the tint) > move > idle
 * Death beats everything; the roll beats attacks because the sim cancels a wind-up and pauses the combo while rolling;
 * attacks beat the hit flinch because a hit never interrupts a swing or a lunge in the sim (the tint / blink shows the
 * hit instead). One-shots driven by a gameplay timer (roll, swing, hit, corpse) are STRETCHED over that timer:
 * frame = floor(progress * frames), clamped (last frame held). Loops (idle, run / move) and one-shots without a timer
 * (the player's death) advance a per-view clock at the animation's fps; run / move scale it by speed / reference speed.
 */
import { CAMERA_PITCH_DEG, STUDS_PER_TILE } from "shared/config";
import {
	AiState,
	CORPSE_TICKS,
	HIT_FLASH_TICKS,
	HURT_INVULN_TICKS,
	ROLL_TICKS,
	SIM_HZ,
	SWARMER,
	SWARMER_LUNGE,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	attackTicks,
	type ActorState,
	type PlayerState,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import type { Pivot, SpriteAnimationDef, SpriteFacings } from "shared/theme";
import { ACTOR_VIEW, SPRITE_VIEW } from "./config";
import { degToRad, isoBasis, type IsoBasis } from "./iso";

const FULL_TURN = 360;
const HALF = 0.5;

/** Where the choosers look animations up: a theme `SpriteSet` / `SpriteSetLayout` (exact names, no warning). */
export interface SpriteAnimSource {
	animation(anim: string): SpriteAnimationDef | undefined;
}

// ---------------------------------------------------------------------------------------------
// Facing

function wrapDeg(deg: number): number {
	let a = deg - math.floor(deg / FULL_TURN) * FULL_TURN;
	if (a >= FULL_TURN) a -= FULL_TURN; // -tiny + 360 rounds to 360
	return a === 0 ? 0 : a; // no -0
}

/**
 * Screen angle, degrees in [0, 360), of the ground direction (faceX, faceZ) as `basis` frames it: 0 = screen right,
 * 90 = screen up (away from the camera), 270 = screen down (towards the camera). Uses the true projection (right
 * and up components), see the file comment. A zero vector gives 0.
 */
export function screenAngleFromBasis(faceX: number, faceZ: number, basis: IsoBasis): number {
	const r = basis.right;
	const u = basis.up;
	const sx = faceX * r[0] + faceZ * r[2];
	const sy = faceX * u[0] + faceZ * u[2];
	if (sx === 0 && sy === 0) return 0;
	return wrapDeg((math.atan2(sy, sx) * 180) / math.pi);
}

/** screenAngleFromBasis for a camera at `yawDeg` / `pitchDeg` (the client caches the basis instead). */
export function screenAngleDeg(
	faceX: number,
	faceZ: number,
	yawDeg: number,
	pitchDeg: number = CAMERA_PITCH_DEG,
): number {
	return screenAngleFromBasis(faceX, faceZ, isoBasis(degToRad(yawDeg), degToRad(pitchDeg)));
}

/**
 * The facing (row) index in [0, count) nearest to screen angle `angleDeg`. Facing d points at zeroDeg + d * 360 /
 * count, counter-clockwise when `ccw` (clockwise otherwise). An angle exactly halfway between two facings goes to the
 * NEXT one in row order (d + 1, wrapping to 0). Count 1 -> 0.
 */
export function facingIndex(angleDeg: number, facings: SpriteFacings): number {
	const count = facings.count;
	if (count <= 1) return 0;
	const rel = wrapDeg(facings.ccw ? angleDeg - facings.zeroDeg : facings.zeroDeg - angleDeg);
	const index = math.floor((rel * count) / FULL_TURN + HALF);
	return index >= count ? index - count : index;
}

/**
 * The facing index for the sim facing (faceX, faceZ) under `basis`; `previous` when the facing is the zero vector
 * (an actor that has never turned keeps its row).
 */
export function spriteFacing(
	faceX: number,
	faceZ: number,
	facings: SpriteFacings,
	basis: IsoBasis,
	previous: number,
): number {
	if (faceX === 0 && faceZ === 0) return previous;
	return facingIndex(screenAngleFromBasis(faceX, faceZ, basis), facings);
}

// ---------------------------------------------------------------------------------------------
// Animation choice

/**
 * What to play. `progress` set: a one-shot stretched over a gameplay timer (0 at its start, 1 at its end). Unset:
 * clock-driven at the animation's fps times `rate` (loops, and one-shots without a gameplay timer).
 */
export interface SpriteAnimChoice {
	readonly anim: string;
	readonly progress?: number;
	readonly rate: number;
}

/** Ground speed, world units / s, from one tick's position delta (PlayerState / ActorState prevX, prevZ, x, z). */
export function tickSpeed(prevX: number, prevZ: number, x: number, z: number): number {
	const dx = x - prevX;
	const dz = z - prevZ;
	return math.sqrt(dx * dx + dz * dz) * SIM_HZ;
}

/** Remaining-ticks timer of `total` ticks -> elapsed ticks, render-interpolated (the roll tumble's formula). */
function elapsedOf(total: number, remaining: number, alpha: number): number {
	return total - remaining + alpha;
}

function stretched(anim: string, elapsed: number, total: number): SpriteAnimChoice {
	return { anim, progress: total > 0 ? elapsed / total : 1, rate: 1 };
}

function clocked(anim: string, rate: number): SpriteAnimChoice {
	return { anim, rate };
}

/** Run / move loop: undefined when standing (below SPRITE_VIEW.moveMinFraction of the reference speed). */
function moveChoice(anim: string, speed: number, refSpeed: number): SpriteAnimChoice | undefined {
	if (!(refSpeed > 0) || !(speed >= refSpeed * SPRITE_VIEW.moveMinFraction)) return undefined;
	const rate = math.min(SPRITE_VIEW.loopRateMax, math.max(SPRITE_VIEW.loopRateMin, speed / refSpeed));
	return clocked(anim, rate);
}

const IDLE: SpriteAnimChoice = { anim: "idle", rate: 1 };

/** Sword swing timings, ticks (SWORD_DATA). Pass attackTicks()-scaled recoveries for Swift Strikes. */
export interface SwordTiming {
	/** Swings 1 and 2: their recovery (SWORD_DATA.swingRecoveryTicks). */
	readonly swingTicks: number;
	/** The finisher's wind-up, lunge included (SWORD_DATA.finisherWindupTicks). */
	readonly windupTicks: number;
	/** The finisher's recovery (SWORD_DATA.finisherRecoveryTicks). */
	readonly finisherTicks: number;
}

export const SWORD_TIMING: SwordTiming = {
	swingTicks: SWORD_DATA.swingRecoveryTicks,
	windupTicks: SWORD_DATA.finisherWindupTicks,
	finisherTicks: SWORD_DATA.finisherRecoveryTicks,
};

/**
 * The sword's timings for player `playerIndex` through their run modifiers (M2 Swift Strikes shortens both recoveries
 * via attackTicks, as sword.ts does; the finisher's wind-up is not scaled). SWORD_TIMING itself when unmodified.
 */
export function swordTimingOf(state: Readonly<SimState>, playerIndex: number): SwordTiming {
	const swingTicks = attackTicks(state, playerIndex, SWORD_DATA.swingRecoveryTicks);
	const finisherTicks = attackTicks(state, playerIndex, SWORD_DATA.finisherRecoveryTicks);
	if (swingTicks === SWORD_TIMING.swingTicks && finisherTicks === SWORD_TIMING.finisherTicks) return SWORD_TIMING;
	return { swingTicks, windupTicks: SWORD_DATA.finisherWindupTicks, finisherTicks };
}

/** A sword swing in progress: combo index (1, 2, 3 = finisher) and progress through its animation, 0..1. */
export interface SwordSwing {
	readonly index: number;
	readonly progress: number;
}

/**
 * The sword swing to animate, from raw sim numbers:
 *   tick        SimState.tick
 *   swingTick   WeaponsState.swingTick (-1: never swung)
 *   lastSwing   the sword slot's v[SWORD_V_LAST] (0 none, 1 / 2 combo swings, 3 finisher)
 *   windupBusy  the ACTIVE sword slot's v[SWORD_V_BUSY] while v[SWORD_V_STEP] === SWORD_STEP_WINDUP, else -1
 * Swings 1 / 2 are stretched over their recovery from the swing tick. The finisher (attack.3) is one timeline: the
 * wind-up (lunge) then the recovery, the strike landing at windupTicks / (windupTicks + finisherTicks). Undefined
 * once the swing's recovery has run out.
 */
export function swordSwing(
	tick: number,
	alpha: number,
	swingTick: number,
	lastSwing: number,
	windupBusy: number,
	timing: SwordTiming = SWORD_TIMING,
): SwordSwing | undefined {
	const finisherTotal = timing.windupTicks + timing.finisherTicks;
	if (windupBusy >= 0) {
		const elapsed = math.min(timing.windupTicks, timing.windupTicks - math.max(0, windupBusy - alpha));
		return { index: SWORD_FINISHER, progress: elapsed / finisherTotal };
	}
	if (swingTick < 0) return undefined;
	const age = tick - 1 - swingTick + alpha; // the swing happened on tick swingTick; state.tick is one past it
	if (age < 0) return undefined;
	if (lastSwing === SWORD_FINISHER) {
		return age < timing.finisherTicks
			? { index: SWORD_FINISHER, progress: (timing.windupTicks + age) / finisherTotal }
			: undefined;
	}
	if (lastSwing < 1 || lastSwing >= SWORD_FINISHER || age >= timing.swingTicks) return undefined;
	return { index: lastSwing, progress: age / timing.swingTicks };
}

/**
 * swordSwing read from a player's weapon sets: the slot holding `swordIndex` (weaponIndex(SWORD.id)) gives the last
 * swing, the active set's sword the wind-up. Undefined when no set holds the sword (or swordIndex is NO_WEAPON).
 */
export function swordSwingOf(
	tick: number,
	alpha: number,
	w: Readonly<WeaponsState>,
	swordIndex: number,
	timing: SwordTiming = SWORD_TIMING,
): SwordSwing | undefined {
	if (swordIndex < 0) return undefined; // NO_WEAPON: never match an empty slot
	let lastSwing = -1;
	for (const slot of w.sets) {
		if (slot.weapon === swordIndex) {
			lastSwing = slot.v[SWORD_V_LAST];
			break;
		}
	}
	if (lastSwing < 0) return undefined;
	const active = w.sets[w.activeSet];
	const windupBusy =
		active !== undefined && active.weapon === swordIndex && active.v[SWORD_V_STEP] === SWORD_STEP_WINDUP
			? active.v[SWORD_V_BUSY]
			: -1;
	return swordSwing(tick, alpha, w.swingTick, lastSwing, windupBusy, timing);
}

/** What the player's sprite needs from sim state (playerSpriteInput fills it). */
export interface PlayerSpriteInput {
	/** PlayerState.dead !== 0. */
	readonly dead: boolean;
	/** PlayerState.rollTicks: roll ticks left, including the current one (> 0 = rolling; ROLL_TICKS long). */
	readonly rollTicks: number;
	/** PlayerState.hurtTicks: post-hit invulnerability left (HURT_INVULN_TICKS long). */
	readonly hurtTicks: number;
	/** swordSwingOf(...): the sword swing in progress, if any (the bow has no knight animation). */
	readonly swing: SwordSwing | undefined;
	/** Ground speed, world units / s (tickSpeed of prevX, prevZ, x, z). */
	readonly speed: number;
	/** The sim's render alpha. */
	readonly alpha: number;
}

/** PlayerSpriteInput from a player and their weapon sets (state.tick, SimController alpha). */
export function playerSpriteInput(
	p: Readonly<PlayerState>,
	w: Readonly<WeaponsState>,
	tick: number,
	alpha: number,
	swordIndex: number,
	timing: SwordTiming = SWORD_TIMING,
): PlayerSpriteInput {
	return {
		dead: p.dead !== 0,
		rollTicks: p.rollTicks,
		hurtTicks: p.hurtTicks,
		swing: swordSwingOf(tick, alpha, w, swordIndex, timing),
		speed: tickSpeed(p.prevX, p.prevZ, p.x, p.z),
		alpha,
	};
}

function attackAnim(anims: SpriteAnimSource, index: number): string | undefined {
	const named = `attack.${index}`;
	if (anims.animation(named) !== undefined) return named;
	return anims.animation("attack") !== undefined ? "attack" : undefined;
}

/** The player's animation: death > roll > attack > hit > run > idle (file comment), skipping absent animations. */
export function choosePlayerAnim(input: PlayerSpriteInput, anims: SpriteAnimSource): SpriteAnimChoice {
	if (input.dead) {
		// No gameplay timer drives the player's death: it plays once at its fps and holds the last frame.
		if (anims.animation("death") !== undefined) return clocked("death", 1);
	} else {
		if (input.rollTicks > 0 && anims.animation("roll") !== undefined) {
			return stretched("roll", elapsedOf(ROLL_TICKS, input.rollTicks, input.alpha), ROLL_TICKS);
		}
		const swing = input.swing;
		if (swing !== undefined) {
			const anim = attackAnim(anims, swing.index);
			if (anim !== undefined) return { anim, progress: swing.progress, rate: 1 };
		}
		if (input.hurtTicks > 0 && anims.animation("hit") !== undefined) {
			const elapsed = elapsedOf(HURT_INVULN_TICKS, input.hurtTicks, input.alpha);
			if (elapsed < SPRITE_VIEW.playerHitTicks) return stretched("hit", elapsed, SPRITE_VIEW.playerHitTicks);
		}
		if (anims.animation("run") !== undefined) {
			const run = moveChoice("run", input.speed, SPRITE_VIEW.playerRunRefSpeed);
			if (run !== undefined) return run;
		}
	}
	return IDLE;
}

/** An actor's attack as one timeline: elapsed ticks (render-interpolated) of `total`. */
export interface ActorAttack {
	readonly elapsed: number;
	readonly total: number;
}

/** What an actor's sprite needs from sim state (swarmerSpriteInput fills it for the swarmer). */
export interface ActorSpriteInput {
	/** ActorState.alive !== 0. */
	readonly alive: boolean;
	/** ActorState.deadTicks: ticks since death. */
	readonly deadTicks: number;
	/** The archetype's corpse time: data.corpseTicks ?? CORPSE_TICKS. */
	readonly corpseTicks: number;
	/** ActorState.flashTicks: hit flash left (HIT_FLASH_TICKS long). */
	readonly flashTicks: number;
	/** The attack in progress (wind-up included), from the archetype's own states; undefined when not attacking. */
	readonly attack: ActorAttack | undefined;
	/** Ground speed, world units / s (tickSpeed of prevX, prevZ, x, z). */
	readonly speed: number;
	/** Speed at which the move loop plays at its authored fps. */
	readonly refSpeed: number;
	/** The sim's render alpha. */
	readonly alpha: number;
}

/**
 * The swarmer's attack timeline: the wind-up (AiState.TELEGRAPH, lungeTelegraphTicks) then the lunge (SWARMER_LUNGE,
 * lungeTicks), aiTicks counting each down. The recovery after it is not part of it (it stands: idle).
 */
export function swarmerAttack(aiState: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	const d = SWARMER.data;
	const total = d.lungeTelegraphTicks + d.lungeTicks;
	if (aiState === AiState.TELEGRAPH) {
		return { elapsed: math.max(0, elapsedOf(d.lungeTelegraphTicks, aiTicks, alpha)), total };
	}
	if (aiState === SWARMER_LUNGE) {
		return { elapsed: d.lungeTelegraphTicks + math.max(0, elapsedOf(d.lungeTicks, aiTicks, alpha)), total };
	}
	return undefined;
}

/** ActorSpriteInput for a swarmer. */
export function swarmerSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: SWARMER.data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? swarmerAttack(a.aiState, a.aiTicks, alpha) : undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: SPRITE_VIEW.swarmerMoveRefSpeed,
		alpha,
	};
}

/** An actor's animation: death > attack > hit > move > idle (file comment), skipping absent animations. */
export function chooseActorAnim(input: ActorSpriteInput, anims: SpriteAnimSource): SpriteAnimChoice {
	if (!input.alive) {
		if (anims.animation("death") !== undefined) {
			const span = input.corpseTicks * SPRITE_VIEW.deathCorpseFraction;
			return span > 0 ? stretched("death", input.deadTicks + input.alpha, span) : clocked("death", 1);
		}
		return IDLE;
	}
	const attack = input.attack;
	if (attack !== undefined && anims.animation("attack") !== undefined)
		return stretched("attack", attack.elapsed, attack.total);
	// A 1-frame `hit` is a stand-in (S5's skeleton: "hit = blink"): it would freeze the walk, so the tint shows the hit
	// and move / idle keep playing. A real (multi-frame) hit animation plays over the flash.
	const hit = anims.animation("hit");
	if (input.flashTicks > 0 && hit !== undefined && hit.frames > 1) {
		return stretched("hit", elapsedOf(HIT_FLASH_TICKS, input.flashTicks, input.alpha), HIT_FLASH_TICKS);
	}
	if (anims.animation("move") !== undefined) {
		const move = moveChoice("move", input.speed, input.refSpeed);
		if (move !== undefined) return move;
	}
	return IDLE;
}

// ---------------------------------------------------------------------------------------------
// Frames

/** A view's animation clock: the animation it is in and how many frames it has advanced (clock-driven ones). */
export interface SpriteClock {
	readonly anim: string;
	readonly phase: number;
}

/** The frame to show; keep it as the view's clock for the next call. */
export interface SpritePick extends SpriteClock {
	readonly frame: number;
}

/** floor(progress * frames), clamped to [0, frames - 1] (progress > 1 holds the last frame; NaN -> 0). */
export function stretchedFrame(progress: number, frames: number): number {
	const last = math.max(1, frames) - 1;
	const f = math.floor(progress * (last + 1));
	return f >= 0 ? math.min(f, last) : 0;
}

/**
 * The frame of `choice` this render frame. Stretched: from its progress. Clock-driven: the clock restarts at frame 0
 * when the animation changes (or with no clock), else advances `dtSec * fps * rate` frames; loops wrap, one-shots
 * hold their last frame. An animation the set lacks (only idle can get here) shows frame 0.
 */
export function spriteFrame(
	anims: SpriteAnimSource,
	choice: SpriteAnimChoice,
	clock: SpriteClock | undefined,
	dtSec: number,
): SpritePick {
	const anim = choice.anim;
	const def = anims.animation(anim);
	if (def === undefined) return { anim, phase: 0, frame: 0 };
	const frames = math.max(1, def.frames);
	const progress = choice.progress;
	if (progress !== undefined) return { anim, phase: 0, frame: stretchedFrame(progress, frames) };
	if (clock === undefined || clock.anim !== anim) return { anim, phase: 0, frame: 0 };
	let phase = clock.phase + math.max(0, dtSec) * def.fps * choice.rate;
	if (!(phase >= 0)) phase = 0;
	if (def.loop) {
		phase -= math.floor(phase / frames) * frames;
		return { anim, phase, frame: math.min(frames - 1, math.floor(phase)) };
	}
	phase = math.min(phase, frames);
	return { anim, phase, frame: math.min(frames - 1, math.floor(phase)) };
}

// ---------------------------------------------------------------------------------------------
// Billboard

/** The SpriteSetAsset fields that size and place the billboard. */
export interface SpriteLayout {
	readonly frameW: number;
	readonly frameH: number;
	readonly pivot: Readonly<Pivot>;
	readonly pixelsPerTile: number;
}

/**
 * Billboard size in studs and the offset from the actor's feet (the anchor) to the billboard's centre in billboard /
 * camera space (x right, y up, z toward the camera), so the pivot pixel lands on the feet. Moving along z does not move
 * the sprite on screen; it moves it in depth.
 *
 * Floor clearance. The billboard is a screen-aligned plane through the feet, tilted back by the camera pitch, and it is
 * depth-tested. The cell below the pivot (the baked shadow, the feet's lower edge) hangs down the camera's up axis, and
 * a point `b` studs down that axis is b * cos(pitch) below the feet: under the floor, so the floor would hide it. A
 * shift `d` toward the camera raises every point by d * sin(pitch), so the whole cell clears the floor when
 * d >= b * cot(pitch). offsetZ = that minimum (plus SPRITE_VIEW.floorClearanceMarginStuds) + `depthBiasStuds`
 * (SPRITE_VIEW.depthBiasStuds, the wall tuning of spike S0, on top).
 */
export interface SpriteBillboard {
	readonly w: number;
	readonly h: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly offsetZ: number;
}

/** The camera-ward shift that lifts a point `belowStuds` down the camera's up axis back onto the floor (+ margin). */
export function floorClearanceStuds(belowStuds: number, pitchDeg: number = CAMERA_PITCH_DEG): number {
	if (!(belowStuds > 0)) return 0;
	const p = degToRad(pitchDeg);
	return (belowStuds * math.cos(p)) / math.sin(p) + SPRITE_VIEW.floorClearanceMarginStuds;
}

export function spriteBillboard(
	layout: SpriteLayout,
	studsPerTile: number = STUDS_PER_TILE,
	depthBiasStuds: number = SPRITE_VIEW.depthBiasStuds,
	pitchDeg: number = CAMERA_PITCH_DEG,
): SpriteBillboard {
	const s = studsPerTile / layout.pixelsPerTile;
	const below = (layout.frameH - layout.pivot.y) * s;
	return {
		w: layout.frameW * s,
		h: layout.frameH * s,
		offsetX: (layout.frameW / 2 - layout.pivot.x) * s,
		offsetY: (layout.pivot.y - layout.frameH / 2) * s,
		offsetZ: floorClearanceStuds(below, pitchDeg) + depthBiasStuds,
	};
}

/**
 * Where a flat floor image's centre sits relative to its pivot (default: the centre, so [0, 0]), studs, in the frame
 * floorImageSize lays it in: [x along the camera's right, z toward the camera], with the image's top edge away from the
 * camera (rows down the image = toward the camera, stretched by 1 / sin(pitch) like its depth).
 */
export function floorImageOffset(
	wPx: number,
	hPx: number,
	pixelsPerTile: number,
	pivot?: Readonly<Pivot>,
	studsPerTile: number = STUDS_PER_TILE,
	pitchDeg: number = CAMERA_PITCH_DEG,
): readonly [number, number] {
	if (pivot === undefined) return [0, 0];
	const s = studsPerTile / pixelsPerTile;
	return [(wPx / 2 - pivot.x) * s, ((hPx / 2 - pivot.y) * s) / math.sin(degToRad(pitchDeg))];
}

/**
 * A flat floor image (the co-op ring) in studs, [x, z]: x = w / pixelsPerTile tiles; z is h / pixelsPerTile tiles
 * stretched by 1 / sin(pitch), because the art is drawn as seen on screen and the camera foreshortens the floor's
 * depth by sin(pitch). Lay it with its x axis along the camera's right (turned by the camera yaw).
 */
export function floorImageSize(
	wPx: number,
	hPx: number,
	pixelsPerTile: number,
	studsPerTile: number = STUDS_PER_TILE,
	pitchDeg: number = CAMERA_PITCH_DEG,
): readonly [number, number] {
	const s = studsPerTile / pixelsPerTile;
	return [wPx * s, (hPx * s) / math.sin(degToRad(pitchDeg))];
}

/**
 * A camera-facing image `heightTiles` tall (the whole image) with `pivot` (default: its bottom centre) on the anchor,
 * e.g. the relic pedestal's beam on the pedestal's top; the part below the pivot clears that surface like a sprite.
 */
export function uprightImageBillboard(
	wPx: number,
	hPx: number,
	heightTiles: number,
	pivot?: Readonly<Pivot>,
	studsPerTile: number = STUDS_PER_TILE,
): SpriteBillboard {
	return spriteBillboard(
		{ frameW: wPx, frameH: hPx, pivot: pivot ?? { x: wPx / 2, y: hPx }, pixelsPerTile: hPx / heightTiles },
		studsPerTile,
		0,
	);
}

/**
 * The animation clock's step this render frame: sim seconds since the last frame ((tick + alpha) / SIM_HZ), so it
 * stops while the run is paused and follows hitstop; 0 on the first frame, capped at SPRITE_VIEW.maxAnimDtSec, never
 * negative (a new run).
 */
export function animDtSec(prevSimSec: number | undefined, simSec: number): number {
	if (prevSimSec === undefined) return 0;
	const d = simSec - prevSimSec;
	return d > 0 ? math.min(d, SPRITE_VIEW.maxAnimDtSec) : 0;
}

// ---------------------------------------------------------------------------------------------
// Looks (shared by the placeholder and sprite paths of ActorRenderController)

/** An actor's / the player's tint state; every look but "normal" names a colour role in ACTOR_VIEW.lookRoles. */
export type ActorLook = "normal" | "flash" | "telegraph" | "iframes" | "dead";

/** Actor: the hit flash, else the telegraph pulse (ACTOR_VIEW.telegraphPulseTicks on / off) while winding up. */
export function actorLook(alive: number, flashTicks: number, aiState: number, tick: number): ActorLook {
	if (alive === 0) return "normal";
	if (flashTicks > 0) return "flash";
	const pulseOn = math.floor(tick / ACTOR_VIEW.telegraphPulseTicks) % 2 === 0;
	return aiState === AiState.TELEGRAPH && pulseOn ? "telegraph" : "normal";
}

/** Player: dead, else dodge i-frames. */
export function playerLook(dead: number, iframeTicks: number): ActorLook {
	if (dead !== 0) return "dead";
	return iframeTicks > 0 ? "iframes" : "normal";
}

/** The post-hit blink (ACTOR_VIEW.blinkTicks shown / hidden, from the sim's hurtTicks): is the player drawn? */
export function playerBlinkVisible(dead: number, hurtTicks: number): boolean {
	return dead !== 0 || hurtTicks === 0 || math.floor(hurtTicks / ACTOR_VIEW.blinkTicks) % 2 === 0;
}

/** Corpse fade: 0 alive, deadTicks / corpseTicks while dead (1 at once without a corpse time). */
export function corpseTransparency(alive: number, deadTicks: number, corpseTicks: number): number {
	if (alive !== 0) return 0;
	return corpseTicks > 0 ? math.clamp(deadTicks / corpseTicks, 0, 1) : 1;
}

/** Archetypes drawn as sprites when the pack has a sprite set for their spriteId: archetype ID -> input builder. */
export const ACTOR_SPRITE_INPUTS: ReadonlyMap<string, (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput> =
	new Map([[SWARMER.id, swarmerSpriteInput]]);
