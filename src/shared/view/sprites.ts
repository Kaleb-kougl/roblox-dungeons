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
 *   actor:  death > special (a boss's intro / taunt roar, the Demon Lord's summon) > attack (a named one, else
 *           `attack`) > hit (multi-frame only; a 1-frame stand-in leaves it to the tint) > move > idle
 * An actor's attack comes from its archetype's own states (ACTOR_SPRITE_INPUTS): the swarmer's wind-up + lunge, the
 * sniper's line telegraph, the bruiser's leap + slam, Mother Bramble's phased attacks, the Demon Lord's swings
 * (demonlordSpriteInput); a turret (turret.sniper, and the M1 turrets turret.sprayer / turret.caster of
 * docs/DEMON_ART.md Phase 2) never attacks or moves (idle loop), and its corpse is the one dead spell before it
 * respawns alive (turretShared.ts).
 * Death beats everything; the roll beats attacks because the sim cancels a wind-up and pauses the combo while rolling;
 * attacks beat the hit flinch because a hit never interrupts a swing or a lunge in the sim (the tint / blink shows the
 * hit instead). A special is a one-shot that is no attack (the boss is immune or summoning): a set without it (and
 * without the builder's `fallback`) plays what would play without it (move / idle), never an attack swing. One-shots driven by a gameplay timer (roll, swing,
 * hit, corpse, a boss's roar and attacks) are STRETCHED over that timer:
 * frame = floor(progress * frames), clamped (last frame held). Loops (idle, run / move) and one-shots without a timer
 * (the player's death) advance a per-view clock at the animation's fps; run / move scale it by speed / reference speed.
 *
 * Boss machinery (docs/BRAMBLE_ART.md BR4, BD7; shared with docs/BOSS_DEMONLORD.md D6). An actor attack may name its
 * animation (`attack.2`; `attack` when the set lacks it) and play only a SEGMENT of it (AnimSegment, fractions of its
 * frames from SPRITE_ANIM_MARKS): the wind-up stretched over the telegraph, the release over a volley, a looped release
 * (the spiral's channel, at the animation's fps), the leap's airborne and landing parts. A `special` is a one-shot with
 * its own gameplay timer (the bosses' roars, the Demon Lord's summon; ActorSpecial.fallback names a stand-in: Mother
 * Bramble's `intro` falls back to `taunt`); it beats attacks because a roar never overlaps one. `flinch: false`
 * (Mother Bramble, BD3) never plays `hit`: the tint carries the hits. `deathTicks` / `corpseFadeFrom` (the Demon Lord)
 * stretch the death over part of the corpse time and start the fade after it.
 */
import { CAMERA_PITCH_DEG, PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import {
	AiState,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BOSS_TELEGRAPH_TICKS,
	BRUISER,
	BRUISER_RECOVER,
	BossAttack,
	BossState,
	CHARGE_IMPACT_HOLD_TICKS,
	CLEAVE_HOLD_TICKS,
	CORPSE_TICKS,
	DEMONLORD_DATA,
	DEMONLORD_TELEGRAPH_TICKS,
	DEMONLORD_V_MARK,
	DOUBLE_CLEAVE_DELAY_TICKS,
	DOUBLE_RING_DELAY_TICKS,
	DemonlordAttack,
	DemonlordState,
	FAN_VOLLEY_TICKS,
	FAST_FAN_VOLLEY_TICKS,
	HELLFIRE_HOLD_TICKS,
	SUMMON_HOLD_TICKS,
	HIT_FLASH_TICKS,
	HURT_INVULN_TICKS,
	ROLL_TICKS,
	SHOCK2_DELAY_TICKS,
	SIM_DT,
	SIM_HZ,
	SLAM_MAX_TICKS,
	SLAM_SPEED,
	SNIPER,
	SPIRAL_TICKS,
	SWARMER,
	SWARMER_LUNGE,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	TURRET_CASTER,
	TURRET_SNIPER,
	TURRET_SPRAYER,
	V_AUX_X,
	V_AUX_Z,
	V_LAST,
	V_MARK,
	attackTicks,
	type ActorState,
	type ArchetypeData,
	type PlayerState,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import type { Pivot, SpriteAnimationDef, SpriteFacings } from "shared/theme";
import { ACTOR_VIEW, SPRITE_ANIM_MARKS, SPRITE_VIEW } from "./config";
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
	/** With `progress`: the part of the animation the progress spans (a wind-up, a release, ...); all of it when unset. */
	readonly segment?: AnimSegment;
}

/**
 * A part of an animation as fractions of its frame count (SPRITE_ANIM_MARKS): frames [round(from * n), round(to * n))
 * of an n-frame animation, clamped to it, at least one frame (segmentStart / segmentLength).
 */
export interface AnimSegment {
	readonly from: number;
	readonly to: number;
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
const ATTACK = "attack";

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

/**
 * An actor's attack as one timeline: elapsed ticks (render-interpolated) of `total`. `anim`: the set's animation to
 * play (default `attack`); a named one the set lacks falls back to `attack`.
 */
export interface ActorAttack {
	readonly elapsed: number;
	readonly total: number;
	/** The animation: a named attack (e.g. "attack.2"); `attack` when unset or when the set lacks it. */
	readonly anim?: string;
	/** The part of the animation this timeline plays (SPRITE_ANIM_MARKS); all of it when unset. */
	readonly segment?: AnimSegment;
	/** Loop the segment at the animation's fps over `elapsed` (a channel) instead of stretching it over `total`. */
	readonly loop?: boolean;
}

/** The boss specials (optional boss `sprites` animations, theme contract BOSS.optionalAnimations). */
export const SPECIAL_INTRO = "intro";
export const SPECIAL_TAUNT = "taunt";

/**
 * A one-shot that is not an attack (a boss's intro / taunt roar, the Demon Lord's summon), stretched over the
 * gameplay timer that drives it: elapsed ticks (render-interpolated) of `total`. A set without `anim` plays `fallback`
 * (Mother Bramble's intro: `taunt`); without either the special is skipped (what plays without it: move / idle).
 */
export interface ActorSpecial {
	readonly anim: string;
	readonly elapsed: number;
	readonly total: number;
	/** Played instead when the set lacks `anim` (unset: none). */
	readonly fallback?: string;
}

/** What an actor's sprite needs from sim state (the ACTOR_SPRITE_INPUTS builders fill it). */
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
	/** A special one-shot in progress (bosses: intro, taunt, summon); beats the attack. Absent / undefined: none. */
	readonly special?: ActorSpecial;
	/** false: never play `hit` (Mother Bramble, BRAMBLE_ART BD3: the tint carries the hits). Unset: true. */
	readonly flinch?: boolean;
	/** Ticks the death animation is stretched over (default: corpseTicks x SPRITE_VIEW.deathCorpseFraction). */
	readonly deathTicks?: number;
	/**
	 * corpseTransparency's fadeFrom: the corpse stays opaque for this fraction of corpseTicks, then fades (the Demon
	 * Lord: SPRITE_VIEW.bossCorpseFadeFrom, his death plays first). Unset: 0, the fade runs over the whole corpse time.
	 */
	readonly corpseFadeFrom?: number;
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

/**
 * The sniper's attack timeline: the line's telegraph (AiState.TELEGRAPH, telegraphTicks; the aim tracks, then locks
 * for the last lockTicks), aiTicks counting it down. It fires on the telegraph's last tick and goes straight back to
 * repositioning, so there is no strike phase after it (no lunge).
 */
export function sniperAttack(aiState: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH) return undefined;
	const total = SNIPER.data.telegraphTicks;
	return { elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
}

/** ActorSpriteInput for a sniper (it strafes: the move loop scales by SPRITE_VIEW.sniperMoveRefSpeed). */
export function sniperSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: SNIPER.data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? sniperAttack(a.aiState, a.aiTicks, alpha) : undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: SPRITE_VIEW.sniperMoveRefSpeed,
		alpha,
	};
}

/**
 * An ActorSpriteInput builder for a stationary turret with archetype data `data` (turretShared.ts): never attacks
 * (its bursts have no wind-up) and never moves (speed and reference speed 0: the idle loop). Dead, it is a corpse for
 * data.corpseTicks ?? CORPSE_TICKS (death, then the fade); it then stays hidden until it respawns, and reviveActor
 * sets alive = 1 and deadTicks = 0, so a respawned turret is a live idle body again, never a fading corpse.
 */
export function turretSpriteInputOf(
	data: Readonly<ArchetypeData>,
): (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput {
	const corpseTicks = data.corpseTicks ?? CORPSE_TICKS;
	return (a, alpha) => ({
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks,
		flashTicks: a.flashTicks,
		attack: undefined,
		speed: 0,
		refSpeed: 0,
		alpha,
	});
}

/** ActorSpriteInput for the tutorial's turret.sniper (decision D3 of docs/SNIPER_ART.md: it wears the sniper's set). */
export const turretSniperSpriteInput = turretSpriteInputOf(TURRET_SNIPER.data);

/** ActorSpriteInput for M1's turret.sprayer (docs/DEMON_ART.md Phase 2: Demon Spawn 8, idle loop only). */
export const turretSprayerSpriteInput = turretSpriteInputOf(TURRET_SPRAYER.data);

/** ActorSpriteInput for M1's turret.caster (docs/DEMON_ART.md Phase 2: Demon Spawn 11, idle loop only). */
export const turretCasterSpriteInput = turretSpriteInputOf(TURRET_CASTER.data);

// ---------------------------------------------------------------------------------------------
// The Demon Lord (boss.demonlord; docs/BOSS_DEMONLORD.md D6)

const DL = DemonlordAttack;

/** Ticks a Demon Lord attack stays ACTIVE (its hold; the double cleave's lunge and hold), by attack id. */
function demonlordActiveTicks(attack: number): number {
	if (attack === DL.CLEAVE) return CLEAVE_HOLD_TICKS;
	if (attack === DL.DOUBLE_CLEAVE) return DOUBLE_CLEAVE_DELAY_TICKS + CLEAVE_HOLD_TICKS;
	if (attack === DL.HELLFIRE) return HELLFIRE_HOLD_TICKS;
	if (attack === DL.SUMMON) return SUMMON_HOLD_TICKS;
	return 0;
}

/**
 * The elapsed / total ticks of a Demon Lord attack's wind-up + active span (TELEGRAPH aiTicks counts down from its
 * telegraph length, ACTIVE aiTicks up from 0), or undefined outside both.
 */
function demonlordSwing(aiState: number, attack: number, aiTicks: number, alpha: number): [number, number] | undefined {
	const windup = DEMONLORD_TELEGRAPH_TICKS[attack] ?? 0;
	const total = windup + demonlordActiveTicks(attack);
	if (aiState === AiState.TELEGRAPH) return [math.max(0, elapsedOf(windup, aiTicks, alpha)), total];
	if (aiState === DemonlordState.ACTIVE) return [windup + aiTicks + alpha, total];
	return undefined;
}

/**
 * The Demon Lord's attack timeline (SPRITE_VIEW.demonlordAnims names the animations):
 *   CLEAVE / DOUBLE_CLEAVE  `cleave` over the telegraph + the active span (the double cleave's lunge and both arcs)
 *   HELLFIRE                `hellfire` over the telegraph + the hold
 *   CHARGE                  nothing through the wind-up (idle) and the run (move, by speed); `impact` from the impact
 *                           tick (v[MARK] = impact ACTIVE tick + 1) over CHARGE_IMPACT_HOLD_TICKS
 * SUMMON is a special (demonlordSpecial). Undefined between attacks (CHASE, RECOVER, REPOSITION, DORMANT, TRANSITION).
 */
export function demonlordAttack(
	aiState: number,
	attack: number,
	aiTicks: number,
	mark: number,
	alpha: number,
): ActorAttack | undefined {
	const names = SPRITE_VIEW.demonlordAnims;
	if (attack === DL.CHARGE) {
		if (aiState !== DemonlordState.ACTIVE || mark <= 0) return undefined;
		return { elapsed: aiTicks - (mark - 1) + alpha, total: CHARGE_IMPACT_HOLD_TICKS, anim: names.impact };
	}
	if (attack !== DL.CLEAVE && attack !== DL.DOUBLE_CLEAVE && attack !== DL.HELLFIRE) return undefined;
	const swing = demonlordSwing(aiState, attack, aiTicks, alpha);
	if (swing === undefined) return undefined;
	return { elapsed: swing[0], total: swing[1], anim: attack === DL.HELLFIRE ? names.hellfire : names.cleave };
}

/**
 * The Demon Lord's specials: TRANSITION (attack ROAR, immune) plays `intro` in phase 1 (over introTicks) and `taunt`
 * in phases 2-3 (over transitionTicks), aiTicks counting down; SUMMON plays `summon` over its telegraph + hold.
 */
export function demonlordSpecial(
	aiState: number,
	attack: number,
	phase: number,
	aiTicks: number,
	alpha: number,
): ActorSpecial | undefined {
	const names = SPRITE_VIEW.demonlordAnims;
	if (aiState === DemonlordState.TRANSITION) {
		const total = phase <= 1 ? DEMONLORD_DATA.introTicks : DEMONLORD_DATA.transitionTicks;
		return {
			anim: phase <= 1 ? names.intro : names.taunt,
			elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)),
			total,
		};
	}
	if (attack !== DL.SUMMON) return undefined;
	const swing = demonlordSwing(aiState, attack, aiTicks, alpha);
	return swing !== undefined ? { anim: names.summon, elapsed: swing[0], total: swing[1] } : undefined;
}

/** ActorSpriteInput for the Demon Lord (move: CHASE, REPOSITION and the charge's run, by speed; RECOVER idle). */
export function demonlordSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const alive = a.alive !== 0;
	const corpseTicks = DEMONLORD_DATA.corpseTicks ?? CORPSE_TICKS;
	return {
		alive,
		deadTicks: a.deadTicks,
		corpseTicks,
		flashTicks: a.flashTicks,
		attack: alive ? demonlordAttack(a.aiState, a.attack, a.aiTicks, a.v[DEMONLORD_V_MARK], alpha) : undefined,
		special: alive ? demonlordSpecial(a.aiState, a.attack, a.phase, a.aiTicks, alpha) : undefined,
		deathTicks: corpseTicks * SPRITE_VIEW.bossDeathCorpseFraction,
		corpseFadeFrom: SPRITE_VIEW.bossCorpseFadeFrom,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: SPRITE_VIEW.demonlordMoveRefSpeed,
		alpha,
	};
}

/** Wind-up [0, mark) and release [mark, 1] of an attack animation split at `mark` (SPRITE_ANIM_MARKS). */
interface PhasedAnim {
	readonly anim: string;
	readonly windup: AnimSegment;
	readonly release: AnimSegment;
}

function phasedAnim(anim: string, mark: number): PhasedAnim {
	return { anim, windup: { from: 0, to: mark }, release: { from: mark, to: 1 } };
}

const BRUISER_MARKS = SPRITE_ANIM_MARKS.bruiser;
/** The bruiser's leap and slam: the leap over the telegraph, the impact from the slam tick, then the follow-through. */
const BRUISER_LEAP: AnimSegment = { from: 0, to: BRUISER_MARKS.impact };
const BRUISER_IMPACT: AnimSegment = { from: BRUISER_MARKS.impact, to: BRUISER_MARKS.followThrough };
const BRUISER_FOLLOW: AnimSegment = { from: BRUISER_MARKS.followThrough, to: 1 };

/**
 * The bruiser's attack timeline (docs/DEMON_ART.md DA4; its `attack` is Attack 4, a leap and ground slam): the leap
 * (frames before SPRITE_ANIM_MARKS.bruiser.impact) over the telegraph (AiState.TELEGRAPH, telegraphTicks, aiTicks
 * counting down; ctx.telegraph sets it, the telegraph's last tick is aiTicks 1); the slam fires on the tick the telegraph
 * runs out and enters BRUISER_RECOVER with aiTicks = recoverTicks, so that tick shows the impact frame. The impact frames
 * [impact, followThrough) play over the first impactTicks of the recover, then the follow-through [followThrough, end)
 * over the rest (a 1-frame segment: held). Undefined otherwise (chasing, leashing).
 */
export function bruiserAttack(aiState: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	const d = BRUISER.data;
	if (aiState === AiState.TELEGRAPH) {
		const total = d.telegraphTicks;
		return { segment: BRUISER_LEAP, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	if (aiState === BRUISER_RECOVER) {
		const total = d.recoverTicks;
		const since = math.max(0, elapsedOf(total, aiTicks, alpha)); // 0 on the slam tick
		const impact = math.min(BRUISER_MARKS.impactTicks, total);
		if (since < impact) return { segment: BRUISER_IMPACT, elapsed: since, total: impact };
		return { segment: BRUISER_FOLLOW, elapsed: since - impact, total: total - impact };
	}
	return undefined;
}

/** ActorSpriteInput for a bruiser (it plods: the move loop scales by SPRITE_VIEW.bruiserMoveRefSpeed). */
export function bruiserSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: BRUISER.data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? bruiserAttack(a.aiState, a.aiTicks, alpha) : undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: SPRITE_VIEW.bruiserMoveRefSpeed,
		alpha,
	};
}

// --- Mother Bramble (boss.act1, docs/BRAMBLE_ART.md BR4)

const BOSS_MARKS = SPRITE_ANIM_MARKS.bossAct1;
const BOSS_FAN = phasedAnim(ATTACK, BOSS_MARKS.fanRelease);
const BOSS_RING = phasedAnim("attack.2", BOSS_MARKS.ringRelease);
const BOSS_SPIRAL = phasedAnim("attack.3", BOSS_MARKS.spiralRelease);
const BOSS_SLAM_ANIM = "attack.4";
/** The leap: crouch over the telegraph, airborne over the charge, the landing frame on the impact tick, then the rest. */
const BOSS_SLAM_CROUCH: AnimSegment = { from: 0, to: BOSS_MARKS.slamTakeoff };
const BOSS_SLAM_AIR: AnimSegment = { from: BOSS_MARKS.slamTakeoff, to: BOSS_MARKS.slamLanding };
const BOSS_SLAM_LAND: AnimSegment = { from: BOSS_MARKS.slamLanding, to: 1 };

/**
 * Mother Bramble's attack animation per BossAttack (BRAMBLE_ART mapping): FAN / FAST_FAN `attack`, RING / DOUBLE_RING
 * `attack.2`, SPIRAL `attack.3`, SLAM `attack.4`; undefined for NONE and ROAR (the roar is a special).
 */
export function bossAct1AttackAnim(attack: number): string | undefined {
	if (attack === BossAttack.SLAM) return BOSS_SLAM_ANIM;
	return bossPhased(attack)?.anim;
}

function bossPhased(attack: number): PhasedAnim | undefined {
	switch (attack) {
		case BossAttack.FAN:
		case BossAttack.FAST_FAN:
			return BOSS_FAN;
		case BossAttack.RING:
		case BossAttack.DOUBLE_RING:
			return BOSS_RING;
		case BossAttack.SPIRAL:
			return BOSS_SPIRAL;
		default:
			return undefined;
	}
}

/** Ticks between volleys for the fans (0: not a fan). */
function fanVolleyTicks(attack: number): number {
	if (attack === BossAttack.FAN) return FAN_VOLLEY_TICKS;
	if (attack === BossAttack.FAST_FAN) return FAST_FAN_VOLLEY_TICKS;
	return 0;
}

/** A release replayed from the burst `since` ticks ago, over `span` ticks. */
function release(p: PhasedAnim, since: number, span: number, alpha: number): ActorAttack {
	return { anim: p.anim, segment: p.release, elapsed: since + alpha, total: span };
}

/** ACTIVE: aiTicks counts UP from 0, the attack's first bullet tick (act1 runAttack's `t`). */
function bossActiveAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const t = a.aiTicks;
	const attack = a.attack;
	const every = fanVolleyTicks(attack);
	if (every > 0) return release(BOSS_FAN, t % every, every, alpha); // a volley every `every` ticks from t = 0
	switch (attack) {
		case BossAttack.RING:
			// Fires on t = 0 and recovers on that same tick, so the sim never shows it ACTIVE (see bossRecoverAttack).
			return release(BOSS_RING, t, BOSS_MARKS.ringReleaseTicks, alpha);
		case BossAttack.DOUBLE_RING: {
			// Ring 1 on t = 0: its release, then the wind-up again up to ring 2 on t = DOUBLE_RING_DELAY_TICKS (which
			// ends the attack: that tick is RECOVER's first).
			const span = math.min(BOSS_MARKS.ringReleaseTicks, DOUBLE_RING_DELAY_TICKS);
			if (t < span) return release(BOSS_RING, t, span, alpha);
			return {
				anim: BOSS_RING.anim,
				segment: BOSS_RING.windup,
				elapsed: t - span + alpha,
				total: DOUBLE_RING_DELAY_TICKS - span,
			};
		}
		case BossAttack.SPIRAL:
			// The channel: the release loops at its fps over the SPIRAL_TICKS of bursts.
			return { ...release(BOSS_SPIRAL, t, SPIRAL_TICKS, alpha), loop: true };
		case BossAttack.SLAM: {
			const mark = a.v[V_MARK];
			if (mark > 0) {
				// Impact on t = mark - 1: the landing frame, then the rest until the summons (SHOCK2_DELAY_TICKS after it).
				const since = math.max(0, t + 1 - mark);
				return {
					anim: BOSS_SLAM_ANIM,
					segment: BOSS_SLAM_LAND,
					elapsed: since + alpha,
					total: SHOCK2_DELAY_TICKS,
				};
			}
			// Charging toward the locked target (v[V_AUX_*]) at SLAM_SPEED: airborne until the estimated impact tick (the
			// charge lands within a step of the target, or after SLAM_MAX_TICKS; a wall stops it early, and the landing
			// frame then simply comes sooner).
			const dx = a.v[V_AUX_X] - a.x;
			const dz = a.v[V_AUX_Z] - a.z;
			const steps = math.ceil(math.sqrt(dx * dx + dz * dz) / (SLAM_SPEED * SIM_DT));
			const total = math.max(t + 1, math.min(SLAM_MAX_TICKS, t + math.max(1, steps)));
			return { anim: BOSS_SLAM_ANIM, segment: BOSS_SLAM_AIR, elapsed: t + alpha, total };
		}
		default:
			return undefined;
	}
}

/**
 * RECOVER: an attack's LAST burst fires on the tick that enters it (the third fan volley, the ring, the second ring), so
 * the release that started there plays on over RECOVER's first ticks, read from the RECOVER timer (aiTicks counts down
 * from the recover length, which recover() takes from the phase; act1 keeps the attack that ran in v[V_LAST]). The
 * spiral's channel and the slam's landing end with the attack; otherwise (and once the release is over) idle (BD4).
 */
function bossRecoverAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = BOSS_ACT1_DATA;
	const last = a.v[V_LAST];
	const length = last === BossAttack.SLAM ? d.slamRecoverTicks : d.recoverTicks[a.phase] ?? d.recoverTicks[1];
	const since = length - a.aiTicks; // 0 on the tick the last burst fired
	if (since < 0) return undefined;
	const every = fanVolleyTicks(last);
	if (every > 0) return since < every ? release(BOSS_FAN, since, every, alpha) : undefined;
	if (last === BossAttack.RING || last === BossAttack.DOUBLE_RING) {
		const span = BOSS_MARKS.ringReleaseTicks;
		return since < span ? release(BOSS_RING, since, span, alpha) : undefined;
	}
	return undefined;
}

/**
 * Mother Bramble's attack timeline from aiState, attack, aiTicks and v[] (act1.ts): TELEGRAPH (aiTicks counting down
 * from BOSS_TELEGRAPH_TICKS[attack], set by ctx.telegraph; its last tick is aiTicks 1) plays the attack's wind-up (the
 * slam's crouch); ACTIVE (aiTicks counting up from 0 = the first bullet) the release per volley / ring, the looped spiral,
 * the leap; RECOVER the last burst's release, then nothing. Undefined in every other state.
 */
export function bossAct1Attack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	switch (a.aiState) {
		case BossState.TELEGRAPH: {
			const total = BOSS_TELEGRAPH_TICKS[a.attack] ?? 0;
			const elapsed = math.max(0, elapsedOf(total, a.aiTicks, alpha));
			if (a.attack === BossAttack.SLAM)
				return { anim: BOSS_SLAM_ANIM, segment: BOSS_SLAM_CROUCH, elapsed, total };
			const p = bossPhased(a.attack);
			return p !== undefined ? { anim: p.anim, segment: p.windup, elapsed, total } : undefined;
		}
		case BossState.ACTIVE:
			return bossActiveAttack(a, alpha);
		case BossState.RECOVER:
			return bossRecoverAttack(a, alpha);
		default:
			return undefined;
	}
}

/**
 * Mother Bramble's roar (TRANSITION, attack ROAR; aiTicks counting down): the intro roar after engaging plays `intro`
 * over introTicks, a phase change's roar `taunt` over transitionTicks. They are told apart by the phase: engaging sets
 * phase 1 and starts the intro; every later roar comes from beginTransition, which first moves to phase 2 or 3. A set
 * without `intro` plays `taunt` for it (BRAMBLE_ART: Elite 3 has no separate intro animation).
 */
export function bossAct1Special(a: Readonly<ActorState>, alpha: number): ActorSpecial | undefined {
	if (a.aiState !== BossState.TRANSITION) return undefined;
	const d = BOSS_ACT1_DATA;
	const intro = a.phase <= 1;
	const total = intro ? d.introTicks : d.transitionTicks;
	const elapsed = math.max(0, elapsedOf(total, a.aiTicks, alpha));
	return intro
		? { anim: SPECIAL_INTRO, elapsed, total, fallback: SPECIAL_TAUNT }
		: { anim: SPECIAL_TAUNT, elapsed, total };
}

/**
 * ActorSpriteInput for Mother Bramble: the roar as a special, the phased attack timeline, never the hit flinch (BD3),
 * the move loop (REPOSITION) at SPRITE_VIEW.bossAct1MoveRefSpeed; DORMANT and RECOVER (after the release) stand: idle.
 */
export function bossAct1SpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const alive = a.alive !== 0;
	return {
		alive,
		deadTicks: a.deadTicks,
		corpseTicks: BOSS_ACT1_DATA.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: alive ? bossAct1Attack(a, alpha) : undefined,
		special: alive ? bossAct1Special(a, alpha) : undefined,
		flinch: false,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: SPRITE_VIEW.bossAct1MoveRefSpeed,
		alpha,
	};
}

/** The special to play: its own animation, else its fallback (if any); undefined when the set has neither. */
function specialAnim(anims: SpriteAnimSource, special: ActorSpecial): string | undefined {
	if (anims.animation(special.anim) !== undefined) return special.anim;
	const fallback = special.fallback;
	return fallback !== undefined && anims.animation(fallback) !== undefined ? fallback : undefined;
}

/** The attack animation to play: the named one, else `attack`; undefined when the set has neither. */
function actorAttackAnim(anims: SpriteAnimSource, name: string | undefined): string | undefined {
	if (name !== undefined && anims.animation(name) !== undefined) return name;
	return anims.animation(ATTACK) !== undefined ? ATTACK : undefined;
}

function attackChoice(anim: string, def: SpriteAnimationDef, attack: ActorAttack): SpriteAnimChoice {
	const segment = attack.segment;
	if (attack.loop === true) {
		// A channel: the segment loops at the animation's fps from the attack's start (sim time, so it stays in step).
		const len = segment !== undefined ? segmentLength(segment, def.frames) : math.max(1, def.frames);
		let phase = (math.max(0, attack.elapsed) / SIM_HZ) * def.fps;
		phase -= math.floor(phase / len) * len;
		return { anim, progress: phase >= 0 ? phase / len : 0, rate: 1, segment };
	}
	const choice = stretched(anim, attack.elapsed, attack.total);
	return segment !== undefined ? { anim, progress: choice.progress, rate: 1, segment } : choice;
}

/** An actor's animation: death > special > attack > hit > move > idle (file comment), skipping absent animations. */
export function chooseActorAnim(input: ActorSpriteInput, anims: SpriteAnimSource): SpriteAnimChoice {
	if (!input.alive) {
		if (anims.animation("death") !== undefined) {
			const span = input.deathTicks ?? input.corpseTicks * SPRITE_VIEW.deathCorpseFraction;
			return span > 0 ? stretched("death", input.deadTicks + input.alpha, span) : clocked("death", 1);
		}
		return IDLE;
	}
	const special = input.special;
	// A special the set lacks (and its fallback) is skipped: what plays without it (it never overlaps an attack).
	const specialName = special !== undefined ? specialAnim(anims, special) : undefined;
	if (special !== undefined && specialName !== undefined)
		return stretched(specialName, special.elapsed, special.total);
	const attack = input.attack;
	if (attack !== undefined) {
		const anim = actorAttackAnim(anims, attack.anim);
		if (anim !== undefined) return attackChoice(anim, anims.animation(anim)!, attack);
	}
	// A 1-frame `hit` is a stand-in (S5's skeleton: "hit = blink"): it would freeze the walk, so the tint shows the hit
	// and move / idle keep playing. A real (multi-frame) hit animation plays over the flash. Bosses never flinch.
	const hit = anims.animation("hit");
	if (input.flinch !== false && input.flashTicks > 0 && hit !== undefined && hit.frames > 1) {
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

/** First frame of `segment` in a `frames`-frame animation: round(from * frames), clamped to [0, frames - 1] (NaN -> 0). */
export function segmentStart(segment: Readonly<AnimSegment>, frames: number): number {
	const n = math.max(1, frames);
	const f = math.round(segment.from * n);
	return f >= 0 ? math.min(f, n - 1) : 0;
}

/** Frames in `segment`: from segmentStart up to round(to * frames) (clamped to the animation), at least one. */
export function segmentLength(segment: Readonly<AnimSegment>, frames: number): number {
	const n = math.max(1, frames);
	const e = math.round(segment.to * n);
	const stop = e <= n ? e : n; // NaN -> n
	return math.max(1, stop - segmentStart(segment, n));
}

/** stretchedFrame inside `segment` (the whole animation when undefined): its first frame + floor(progress * length). */
export function segmentFrame(progress: number, frames: number, segment?: Readonly<AnimSegment>): number {
	if (segment === undefined) return stretchedFrame(progress, frames);
	return segmentStart(segment, frames) + stretchedFrame(progress, segmentLength(segment, frames));
}

/**
 * The frame of `choice` this render frame. Stretched: from its progress (inside its segment, if any). Clock-driven: the clock restarts at frame 0
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
	if (progress !== undefined) return { anim, phase: 0, frame: segmentFrame(progress, frames, choice.segment) };
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

/**
 * Corpse fade: 0 alive, deadTicks / corpseTicks while dead (1 at once without a corpse time). `fadeFrom` (default 0)
 * holds it at 0 for that fraction of the corpse time and fades over the rest (boss sprites: their death plays first).
 */
export function corpseTransparency(alive: number, deadTicks: number, corpseTicks: number, fadeFrom = 0): number {
	if (alive !== 0) return 0;
	if (!(corpseTicks > 0)) return 1;
	const t = deadTicks / corpseTicks;
	if (fadeFrom <= 0) return math.clamp(t, 0, 1);
	if (fadeFrom >= 1) return t >= 1 ? 1 : 0;
	return math.clamp((t - fadeFrom) / (1 - fadeFrom), 0, 1);
}

/**
 * A boss sprite's layout, drawn at least `minDrawPx` web pixels wide (ACTOR_VIEW.bossMinDrawPx, the placeholder
 * bosses' rule, at PIXELS_PER_TILE pixels per tile): the layout itself when it already is, else a copy with a smaller
 * pixelsPerTile (the billboard grows, the pivot stays on the feet).
 */
export function bossSpriteLayout(layout: SpriteLayout, minDrawPx: number): SpriteLayout {
	if (!(layout.frameW > 0) || !(layout.pixelsPerTile > 0)) return layout;
	if ((layout.frameW / layout.pixelsPerTile) * PIXELS_PER_TILE >= minDrawPx) return layout;
	return {
		frameW: layout.frameW,
		frameH: layout.frameH,
		pivot: layout.pivot,
		pixelsPerTile: (layout.frameW * PIXELS_PER_TILE) / minDrawPx,
	};
}

/**
 * Archetypes drawn as sprites when the pack has a sprite set for their spriteId: archetype ID -> input builder. The
 * swarmer, the sniper, the tutorial's turret.sniper (same spriteId "enemy.sniper", docs/SNIPER_ART.md D3), M1's
 * turret.sprayer / turret.caster ("enemy.sprayer" / "enemy.caster", docs/DEMON_ART.md Phase 2), the bruiser, Mother
 * Bramble (boss.act1) and the Demon Lord (boss.demonlord); every other archetype stays a placeholder. A builder alone
 * draws nothing: ActorRenderController takes the sprite path only when the pack's `sprites(spriteId)` is a set too, so
 * each stays a placeholder until its set lands (docs/DEMON_ART.md DA5 and Phase 2, docs/BRAMBLE_ART.md BR6,
 * docs/BOSS_DEMONLORD.md D7).
 */
export const ACTOR_SPRITE_INPUTS: ReadonlyMap<string, (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput> =
	new Map([
		[SWARMER.id, swarmerSpriteInput],
		[SNIPER.id, sniperSpriteInput],
		[TURRET_SNIPER.id, turretSniperSpriteInput],
		[TURRET_SPRAYER.id, turretSprayerSpriteInput],
		[TURRET_CASTER.id, turretCasterSpriteInput],
		[BRUISER.id, bruiserSpriteInput],
		[BOSS_ACT1_ID, bossAct1SpriteInput],
		[BOSS_DEMONLORD_ID, demonlordSpriteInput],
	]);
