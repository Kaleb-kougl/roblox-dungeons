/**
 * The player's sprite inputs and animation choice: sword, bow, Knight and Archer (docs/CODEBASE_SCALE.md DX8: a pure move out of view/sprites.ts).
 *
 * @module
 */
import {
	BOW_DATA,
	BOW_V_CHARGE,
	BOW_V_HEAVY_TICK,
	BOW_V_SHOT,
	HURT_INVULN_TICKS,
	ROLL_TICKS,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	attackTicks,
	bowChargeTicks,
	playerAt,
	weaponsAt,
	type PlayerState,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import { ARCHER_SPRITE, SPRITE_ANIM_MARKS, SPRITE_VIEW } from "../config";
import {
	IDLE,
	clocked,
	elapsedOf,
	moveChoice,
	stretched,
	tickSpeed,
	type AnimSegment,
	type SpriteAnimChoice,
	type SpriteAnimSource,
} from "./facing";

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
	/** The Archer only (archerSpriteInput): bowShotOf(...), the bow's shot in progress. Absent on every other visual. */
	readonly bow?: BowShot;
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

// ---------------------------------------------------------------------------------------------
// The Archer's bow (docs/ARCHER.md AR12)

/** The bow's timings for the Archer's sprite, ticks. */
export interface BowTiming {
	/** A stream arrow's cooldown: BOW_DATA.cooldownTicks through attackTicks (Swift Strikes). */
	readonly streamTicks: number;
	/** A full charge: bowChargeTicks (Ballista II / III). */
	readonly chargeTicks: number;
	/** The stream's wait after a heavy arrow (BOW_DATA.heavyRecoverTicks): the release plays over it. */
	readonly recoverTicks: number;
}

export const BOW_TIMING: BowTiming = {
	streamTicks: BOW_DATA.cooldownTicks,
	chargeTicks: BOW_DATA.chargeTicks,
	recoverTicks: BOW_DATA.heavyRecoverTicks,
};

/** The bow's timings for player `playerIndex` through their run modifiers; BOW_TIMING itself when unmodified. */
export function bowTimingOf(state: Readonly<SimState>, playerIndex: number): BowTiming {
	const streamTicks = attackTicks(state, playerIndex, BOW_DATA.cooldownTicks);
	const chargeTicks = bowChargeTicks(state, playerIndex);
	if (streamTicks === BOW_TIMING.streamTicks && chargeTicks === BOW_TIMING.chargeTicks) return BOW_TIMING;
	return { streamTicks, chargeTicks, recoverTicks: BOW_DATA.heavyRecoverTicks };
}

/** What the bow is doing: a stream arrow, the charge's draw, or the heavy arrow's release. */
export type BowShotKind = "stream" | "draw" | "release";

/** The bow's shot to animate: progress 0..1 through `segment` of its animation (ARCHER_SPRITE.streamAnim / chargeAnim). */
export interface BowShot {
	readonly kind: BowShotKind;
	readonly progress: number;
	readonly segment: AnimSegment;
}

const ARCHER_MARKS = SPRITE_ANIM_MARKS.archer;
const DRAW_SEGMENT: AnimSegment = { from: 0, to: ARCHER_MARKS.release };
const RELEASE_SEGMENT: AnimSegment = { from: ARCHER_MARKS.release, to: 1 };
const STREAM_SEGMENTS: ReadonlyArray<AnimSegment> = [
	{ from: 0, to: ARCHER_MARKS.streamCycle },
	{ from: ARCHER_MARKS.streamCycle, to: 1 },
];

/**
 * The bow's shot to animate, from raw sim numbers of the ACTIVE set's bow slot:
 *   tick       SimState.tick (one past the tick the sim just stepped)
 *   charge     v[BOW_V_CHARGE]: ticks charged (0 = not charging)
 *   heavyTick  v[BOW_V_HEAVY_TICK]: the tick after the last heavy arrow (0 = none)
 *   cooldown   the slot's cooldown: set on a stream arrow to the stream's cooldown, on a heavy arrow to its wait
 *   shotStep   v[BOW_V_SHOT]: the stream pattern step, advanced after every stream arrow
 * The draw (charging) beats the release (age tick - heavyTick in [0, recoverTicks)) beats a stream arrow (cooldown > 0,
 * age streamTicks - cooldown): the stream cannot fire while drawing and waits recoverTicks after a heavy arrow. The
 * draw's progress is the charge's (1 once full: the anchor holds); a stream arrow plays cycle 0 when shotStep is odd
 * (the arrow just fired took the even step), cycle 1 otherwise. Undefined when the bow is idle.
 */
export function bowShot(
	tick: number,
	alpha: number,
	charge: number,
	heavyTick: number,
	cooldown: number,
	shotStep: number,
	timing: BowTiming = BOW_TIMING,
): BowShot | undefined {
	if (charge > 0) {
		const progress = charge >= timing.chargeTicks ? 1 : math.min(1, (charge + alpha) / timing.chargeTicks);
		return { kind: "draw", progress, segment: DRAW_SEGMENT };
	}
	if (heavyTick > 0) {
		const age = tick - heavyTick + alpha;
		if (age >= 0 && age < timing.recoverTicks) {
			return { kind: "release", progress: age / timing.recoverTicks, segment: RELEASE_SEGMENT };
		}
	}
	if (cooldown > 0 && timing.streamTicks > 0) {
		const age = timing.streamTicks - math.min(cooldown, timing.streamTicks) + alpha;
		if (age < timing.streamTicks) {
			const cycle = shotStep % 2 === 1 ? 0 : 1;
			return { kind: "stream", progress: age / timing.streamTicks, segment: STREAM_SEGMENTS[cycle] };
		}
	}
	return undefined;
}

/**
 * bowShot read from a player's weapon sets: only the ACTIVE set's bow (`bowIndex` = weaponIndex(BOW.id)) animates
 * (a swapped-away bow's cooldown still runs down). Undefined when the active set holds no bow (or bowIndex is
 * NO_WEAPON).
 */
export function bowShotOf(
	tick: number,
	alpha: number,
	w: Readonly<WeaponsState>,
	bowIndex: number,
	timing: BowTiming = BOW_TIMING,
): BowShot | undefined {
	if (bowIndex < 0) return undefined; // NO_WEAPON: never match an empty slot
	const active = w.sets[w.activeSet];
	if (active === undefined || active.weapon !== bowIndex) return undefined;
	const v = active.v;
	return bowShot(tick, alpha, v[BOW_V_CHARGE], v[BOW_V_HEAVY_TICK], active.cooldown, v[BOW_V_SHOT], timing);
}

/** PlayerSpriteInput of the Archer: no sword swing, the bow's shot (bowShotOf). */
export function archerSpriteInput(
	p: Readonly<PlayerState>,
	w: Readonly<WeaponsState>,
	tick: number,
	alpha: number,
	bowIndex: number,
	timing: BowTiming = BOW_TIMING,
): PlayerSpriteInput {
	return {
		dead: p.dead !== 0,
		rollTicks: p.rollTicks,
		hurtTicks: p.hurtTicks,
		swing: undefined,
		bow: bowShotOf(tick, alpha, w, bowIndex, timing),
		speed: tickSpeed(p.prevX, p.prevZ, p.x, p.z),
		alpha,
	};
}

/**
 * The sprite input of player `playerIndex` drawn as `visualId` (their class.* theme id): the Archer's
 * (ARCHER_SPRITE.visualId) reads the bow (archerSpriteInput); every other visual exactly playerSpriteInput with the
 * sword (the Knight's choices unchanged). `swordIndex` / `bowIndex`: weaponIndex of the sword / bow (NO_WEAPON if none).
 * `p`: the body as drawn (docs/LOCAL_PREDICTION.md LP5: the predicted local player); the merged player by default.
 */
export function playerSpriteInputFor(
	visualId: string,
	state: Readonly<SimState>,
	playerIndex: number,
	alpha: number,
	swordIndex: number,
	bowIndex: number,
	p: Readonly<PlayerState> = playerAt(state, playerIndex),
): PlayerSpriteInput {
	const w = weaponsAt(state, playerIndex);
	if (visualId === ARCHER_SPRITE.visualId) {
		return archerSpriteInput(p, w, state.tick, alpha, bowIndex, bowTimingOf(state, playerIndex));
	}
	return playerSpriteInput(p, w, state.tick, alpha, swordIndex, swordTimingOf(state, playerIndex));
}

/**
 * The Archer's bow animation (choosePlayerAnim's attack step), or undefined: the set lacks the animation, or a stream
 * arrow while moving at run speed (ARCHER_SPRITE.streamYieldsToRun, when the set has `run`).
 */
function bowChoice(bow: BowShot, speed: number, anims: SpriteAnimSource): SpriteAnimChoice | undefined {
	const anim = bow.kind === "stream" ? ARCHER_SPRITE.streamAnim : ARCHER_SPRITE.chargeAnim;
	if (anims.animation(anim) === undefined) return undefined;
	if (
		bow.kind === "stream" &&
		ARCHER_SPRITE.streamYieldsToRun &&
		anims.animation("run") !== undefined &&
		moveChoice("run", speed, SPRITE_VIEW.playerRunRefSpeed) !== undefined
	) {
		return undefined;
	}
	return { anim, progress: bow.progress, rate: 1, segment: bow.segment };
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
		const bow = input.bow;
		if (bow !== undefined) {
			const choice = bowChoice(bow, input.speed, anims);
			if (choice !== undefined) return choice;
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
