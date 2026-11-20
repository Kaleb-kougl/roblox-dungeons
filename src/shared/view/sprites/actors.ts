/**
 * Enemy and boss sprite inputs and the actor animation choice (docs/CODEBASE_SCALE.md DX8: a pure move out of view/sprites.ts).
 *
 * @module
 */
import {
	AiState,
	BOSS_ACT1_DATA,
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
	HIT_FLASH_TICKS,
	IMP,
	IMP_ATTACK_BLINK,
	IMP_ATTACK_FAN,
	SHOCK2_DELAY_TICKS,
	SIM_DT,
	SIM_HZ,
	SLAM_MAX_TICKS,
	SLAM_SPEED,
	SLIME,
	SLIME_SMALL,
	SNIPER,
	SPIRAL_TICKS,
	SUMMONER,
	SUMMONER_ATTACK_PANIC,
	SUMMONER_ATTACK_SUMMON,
	SUMMON_HOLD_TICKS,
	SWARMER,
	SWARMER_LUNGE,
	TURRET_CASTER,
	TURRET_SNIPER,
	TURRET_SPRAYER,
	V_AUX_X,
	V_AUX_Z,
	V_LAST,
	V_MARK,
	type ActorState,
	type ArchetypeData,
} from "shared/sim";
import { SPRITE_ANIM_MARKS, SPRITE_VIEW } from "../config";
import { VARIANT_ANIM_MARKS, VARIANT_SPRITE_VIEW } from "../variantsConfig";
import type { SpriteAnimationDef } from "shared/theme";
import {
	ATTACK,
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
import { segmentLength, type SpriteLayout } from "./frames";

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
 * (Mother Mayhem's intro: `taunt`); without either the special is skipped (what plays without it: move / idle).
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
	/** false: never play `hit` (Mother Mayhem, BRAMBLE_ART BD3: the tint carries the hits). Unset: true. */
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
	/**
	 * Roblox port (docs/NEW_ENEMIES.md NE8): a named death played instead of `death` when the set has it (the Bomber's
	 * detonation `death.2`); unset or absent from the set: `death`.
	 */
	readonly deathAnim?: string;
	/**
	 * Roblox port (NE8): a named move loop played instead of `move` when the set has it (the Warbanner's `move.back`
	 * while it backs away); unset or absent from the set: `move`.
	 */
	readonly moveAnim?: string;
	/** Roblox port (NE8): the idle loop's rate (the Reaper's dizzy plays it slowed). Unset: 1. */
	readonly idleRate?: number;
	/**
	 * Roblox port (docs/NEW_ENEMIES_2.md NX7): a named loop played instead of `idle` when the set has it (the
	 * Shieldwall's `block` while it guards standing still); unset or absent from the set: `idle`.
	 */
	readonly idleAnim?: string;
	/**
	 * Roblox port (docs/DUMMY_ART.md DD1): a view-side hit timeline, for a set whose `hit` outlasts the sim's 0.1 s
	 * flash (the training dummy's wobble). The renderer fills it from HitReactSlots.hitAge for the archetypes in
	 * VIEW_HIT_CLIP_SEC. Set: `hit` plays stretched over it while 0 <= elapsed < total, and the flash rule is skipped
	 * (no hit outside the clip). Unset: `hit` plays over the flash.
	 */
	readonly hitClip?: ActorHitClip;
}

/** A view-side hit timeline (ActorSpriteInput.hitClip): seconds since the last hit, and the seconds it plays over. */
export interface ActorHitClip {
	readonly elapsed: number;
	readonly total: number;
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
// Enemy variants (docs/ENEMY_VARIANTS.md EV9): the imp, the Ooze (slime / slime.small) and the summoner

const IMP_MARKS = VARIANT_ANIM_MARKS.imp;
/** The imp's `attack`: the crouch over the blink wind-up, the landing and throw over the landing aim. */
const IMP_CROUCH: AnimSegment = { from: 0, to: IMP_MARKS.land };
const IMP_THROW: AnimSegment = { from: IMP_MARKS.land, to: 1 };

/**
 * The imp's attack timeline (imp.ts view contract): the blink wind-up (TELEGRAPH, IMP_ATTACK_BLINK, blinkTelegraphTicks:
 * the ring fills) plays the crouch, the landing aim (TELEGRAPH, IMP_ATTACK_FAN, landAimTicks, from the landing tick;
 * the fan fires as it runs out) the landing / throw; aiTicks counts each down. Undefined while repositioning.
 */
export function impAttack(aiState: number, attack: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH) return undefined;
	const d = IMP.data;
	if (attack === IMP_ATTACK_BLINK) {
		const total = d.blinkTelegraphTicks;
		return { segment: IMP_CROUCH, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	if (attack === IMP_ATTACK_FAN) {
		const total = d.landAimTicks;
		return { segment: IMP_THROW, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	return undefined;
}

/** ActorSpriteInput for an imp (it strafes: the move loop scales by VARIANT_SPRITE_VIEW.impMoveRefSpeed). */
export function impSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: IMP.data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? impAttack(a.aiState, a.attack, a.aiTicks, alpha) : undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: VARIANT_SPRITE_VIEW.impMoveRefSpeed,
		alpha,
	};
}

/**
 * An ActorSpriteInput builder for a slime with archetype data `data` and move reference speed `refSpeed`: the LoP slime
 * has idle / move / death only (EV0), and the Ooze has no telegraph (the crawl and the puddles are its tell), so it
 * never attacks; a hit is the tint. `slime.small` wears the same set, drawn at its data.spriteScale (actorSpriteScale).
 */
export function slimeSpriteInputOf(
	data: Readonly<ArchetypeData>,
	refSpeed: number,
): (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput {
	const corpseTicks = data.corpseTicks ?? CORPSE_TICKS;
	return (a, alpha) => ({
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks,
		flashTicks: a.flashTicks,
		attack: undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed,
		alpha,
	});
}

/** ActorSpriteInput for the Ooze (`slime`). */
export const slimeSpriteInput = slimeSpriteInputOf(SLIME.data, VARIANT_SPRITE_VIEW.slimeMoveRefSpeed);

/** ActorSpriteInput for a slimelet (`slime.small`, the same set at 0.6x). */
export const slimeSmallSpriteInput = slimeSpriteInputOf(SLIME_SMALL.data, VARIANT_SPRITE_VIEW.slimeSmallMoveRefSpeed);

/**
 * The summoner's attack timeline (summoner.ts view contract): the summon cast (TELEGRAPH, SUMMONER_ATTACK_SUMMON,
 * summonTelegraphTicks; the casting circle fills, the summons burst out as it runs out) plays
 * VARIANT_SPRITE_VIEW.summonerAnims.cast, the panic wind-up (SUMMONER_ATTACK_PANIC, panicTelegraphTicks; the ring fires
 * as it runs out) `.panic`; aiTicks counts each down. Undefined otherwise (keeping range: move / idle; backing off: move).
 */
export function summonerAttack(
	aiState: number,
	attack: number,
	aiTicks: number,
	alpha: number,
): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH) return undefined;
	const d = SUMMONER.data;
	const names = VARIANT_SPRITE_VIEW.summonerAnims;
	if (attack === SUMMONER_ATTACK_SUMMON) {
		const total = d.summonTelegraphTicks;
		return { anim: names.cast, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	if (attack === SUMMONER_ATTACK_PANIC) {
		const total = d.panicTelegraphTicks;
		return { anim: names.panic, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	return undefined;
}

/** ActorSpriteInput for a summoner (the move loop scales by VARIANT_SPRITE_VIEW.summonerMoveRefSpeed). */
export function summonerSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: SUMMONER.data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? summonerAttack(a.aiState, a.attack, a.aiTicks, alpha) : undefined,
		speed: tickSpeed(a.prevX, a.prevZ, a.x, a.z),
		refSpeed: VARIANT_SPRITE_VIEW.summonerMoveRefSpeed,
		alpha,
	};
}

/**
 * The sprite path's draw scale of an actor: its data.spriteScale only for the ids in VARIANT_SPRITE_VIEW
 * .spriteScaledIds (a set shared with a bigger sibling: `slime.small`), times `affixScale` (Hulking: affixDrawScale).
 */
export function actorSpriteScale(id: string, spriteScale: number | undefined, affixScale = 1): number {
	const own = VARIANT_SPRITE_VIEW.spriteScaledIds.includes(id) ? spriteScale ?? 1 : 1;
	return own * affixScale;
}

/** `layout` drawn `scale` times as large (pixelsPerTile / scale: the pivot stays on the feet); itself at scale 1. */
export function scaledSpriteLayout(layout: SpriteLayout, scale: number): SpriteLayout {
	if (scale === 1 || !(scale > 0)) return layout;
	return {
		frameW: layout.frameW,
		frameH: layout.frameH,
		pivot: layout.pivot,
		pixelsPerTile: layout.pixelsPerTile / scale,
	};
}

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

// --- Mother Mayhem (boss.act1, docs/BRAMBLE_ART.md BR4)

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
 * Mother Mayhem's attack animation per BossAttack (BRAMBLE_ART mapping): FAN / FAST_FAN `attack`, RING / DOUBLE_RING
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
 * Mother Mayhem's attack timeline from aiState, attack, aiTicks and v[] (act1.ts): TELEGRAPH (aiTicks counting down
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
 * Mother Mayhem's roar (TRANSITION, attack ROAR; aiTicks counting down): the intro roar after engaging plays `intro`
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
 * ActorSpriteInput for Mother Mayhem: the roar as a special, the phased attack timeline, never the hit flinch (BD3),
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
		const named = input.deathAnim;
		const death = named !== undefined && anims.animation(named) !== undefined ? named : "death";
		if (anims.animation(death) !== undefined) {
			const span = input.deathTicks ?? input.corpseTicks * SPRITE_VIEW.deathCorpseFraction;
			return span > 0 ? stretched(death, input.deadTicks + input.alpha, span) : clocked(death, 1);
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
	// A view-side hit clip (DD1) replaces the flash as the hit's timer.
	const hit = anims.animation("hit");
	const clip = input.hitClip;
	if (input.flinch !== false && hit !== undefined && hit.frames > 1) {
		if (clip !== undefined) {
			if (clip.elapsed >= 0 && clip.elapsed < clip.total) return stretched("hit", clip.elapsed, clip.total);
		} else if (input.flashTicks > 0) {
			return stretched("hit", elapsedOf(HIT_FLASH_TICKS, input.flashTicks, input.alpha), HIT_FLASH_TICKS);
		}
	}
	const namedMove = input.moveAnim;
	const moveName = namedMove !== undefined && anims.animation(namedMove) !== undefined ? namedMove : "move";
	if (anims.animation(moveName) !== undefined) {
		const move = moveChoice(moveName, input.speed, input.refSpeed);
		if (move !== undefined) return move;
	}
	const named = input.idleAnim;
	if (named !== undefined && anims.animation(named) !== undefined) return clocked(named, input.idleRate ?? 1);
	const idleRate = input.idleRate;
	return idleRate !== undefined && idleRate !== 1 ? clocked(IDLE.anim, idleRate) : IDLE;
}
