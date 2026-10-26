import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import {
	ACTOR_SCRATCH_SLOTS,
	AiState,
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKETS,
	HIT_FLASH_TICKS,
	HURT_INVULN_TICKS,
	NO_WEAPON,
	PLAYER_SPEED,
	ROLL_TICKS,
	SQRT1_2,
	SWARMER,
	SWARMER_LUNGE,
	SWARMER_RECOVER,
	SWORD_DATA,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	WEAPON_SCRATCH_SLOTS,
	newPlayerState,
	ATTACK_TICKS_BOON_PERCENT,
	attackTicks,
	type ActorState,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import type { SpriteAnimationDef, SpriteFacings } from "shared/theme";
import {
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	SPRITE_VIEW,
	actorLook,
	animDtSec,
	corpseTransparency,
	floorClearanceStuds,
	floorImageOffset,
	floorImageSize,
	playerBlinkVisible,
	playerLook,
	uprightImageBillboard,
	SWORD_TIMING,
	chooseActorAnim,
	choosePlayerAnim,
	degToRad,
	dot,
	facingIndex,
	isoBasis,
	playerSpriteInput,
	screenAngleDeg,
	screenAngleFromBasis,
	spriteBillboard,
	spriteFacing,
	spriteFrame,
	stretchedFrame,
	swarmerAttack,
	swarmerSpriteInput,
	swordSwing,
	swordSwingOf,
	swordTimingOf,
	tickSpeed,
	type ActorSpriteInput,
	type PlayerSpriteInput,
	type SpriteAnimSource,
} from "shared/view";

/** Angles come out of libm trig (platform-dependent in the last ulp): compared to 9 decimals. */
const DEG_DIGITS = 9;
/** atan(sin pitch): how far from the screen's horizontal a world diagonal (relative to the camera) shows, degrees. */
const DIAG = (math.atan(math.sin(degToRad(CAMERA_PITCH_DEG))) * 180) / math.pi;

function facings(count: 1 | 4 | 8 | 16, zeroDeg = 0, ccw = true): SpriteFacings {
	return { count, zeroDeg, ccw };
}

function anim(frames: number, fps: number, loop: boolean): SpriteAnimationDef {
	return { sheet: 0, start: 0, frames, fps, loop };
}

/** A SpriteAnimSource over a plain record (the theme's SpriteSet in the client). */
function source(anims: Readonly<Record<string, SpriteAnimationDef>>): SpriteAnimSource & {
	readonly anims: Readonly<Record<string, SpriteAnimationDef>>;
} {
	return {
		anims,
		animation(anim: string) {
			return anims[anim];
		},
	};
}

const KNIGHT_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(4, 8, true),
	run: anim(8, 12, true),
	roll: anim(6, 15, false),
	hit: anim(3, 12, false),
	death: anim(10, 10, false),
	"attack.1": anim(6, 20, false),
	"attack.2": anim(6, 20, false),
	"attack.3": anim(8, 20, false),
};

const KNIGHT = source(KNIGHT_ANIMS);

const SKELETON_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(1, 1, true),
	move: anim(8, 10, true),
	attack: anim(8, 10, false),
	hit: anim(1, 1, false),
	death: anim(8, 10, false),
};
const SKELETON = source(SKELETON_ANIMS);

describe("screenAngleDeg", () => {
	it("maps the player's spawn facing (towards the camera) to screen-down, 270", () => {
		expect(screenAngleDeg(SQRT1_2, SQRT1_2, CAMERA_YAW_DEG)).toBeCloseTo(270, DEG_DIGITS);
		expect(screenAngleDeg(-SQRT1_2, -SQRT1_2, CAMERA_YAW_DEG)).toBeCloseTo(90, DEG_DIGITS);
		expect(screenAngleDeg(SQRT1_2, -SQRT1_2, CAMERA_YAW_DEG)).toBeCloseTo(0, DEG_DIGITS);
		expect(screenAngleDeg(-SQRT1_2, SQRT1_2, CAMERA_YAW_DEG)).toBeCloseTo(180, DEG_DIGITS);
	});

	it("puts each world axis at yaw 45 on the pitch-foreshortened diagonal, not at 45 degrees", () => {
		// +X: right and down; +Z: left and down; -X: left and up; -Z: right and up.
		expect(DIAG).toBeCloseTo(39.3227, 3);
		expect(screenAngleDeg(1, 0, CAMERA_YAW_DEG)).toBeCloseTo(360 - DIAG, DEG_DIGITS);
		expect(screenAngleDeg(0, 1, CAMERA_YAW_DEG)).toBeCloseTo(180 + DIAG, DEG_DIGITS);
		expect(screenAngleDeg(-1, 0, CAMERA_YAW_DEG)).toBeCloseTo(180 - DIAG, DEG_DIGITS);
		expect(screenAngleDeg(0, -1, CAMERA_YAW_DEG)).toBeCloseTo(DIAG, DEG_DIGITS);
	});

	it("is the plain yaw rotation only for a top-down camera (pitch 90)", () => {
		expect(screenAngleDeg(1, 0, CAMERA_YAW_DEG, 90)).toBeCloseTo(315, DEG_DIGITS);
		expect(screenAngleDeg(0, 1, CAMERA_YAW_DEG, 90)).toBeCloseTo(225, DEG_DIGITS);
	});

	it("stays in [0, 360) and turns monotonically (clockwise on screen) as the world facing turns +X -> +Z", () => {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		const steps = 720;
		let prev = screenAngleFromBasis(1, 0, basis);
		let total = 0;
		for (let i = 1; i <= steps; i++) {
			const t = (i / steps) * 2 * math.pi;
			const a = screenAngleFromBasis(math.cos(t), math.sin(t), basis);
			expect(a >= 0 && a < 360).toBe(true);
			let d = a - prev;
			if (d > 180) d -= 360;
			if (d <= -180) d += 360;
			expect(d).toBeLessThan(0);
			total += d;
			prev = a;
		}
		expect(total).toBeCloseTo(-360, 6);
	});

	it("gives 0 for a zero vector; spriteFacing keeps the previous row then", () => {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(screenAngleFromBasis(0, 0, basis)).toBe(0);
		expect(spriteFacing(0, 0, facings(8), basis, 5)).toBe(5);
		expect(spriteFacing(SQRT1_2, SQRT1_2, facings(8), basis, 5)).toBe(6);
		expect(spriteFacing(SQRT1_2, SQRT1_2, facings(16), basis, 0)).toBe(12);
		expect(spriteFacing(SQRT1_2, SQRT1_2, facings(4), basis, 0)).toBe(3);
	});
});

describe("facingIndex", () => {
	it("is 0 for a single facing", () => {
		expect(facingIndex(123, facings(1))).toBe(0);
	});

	it("picks the nearest of 4, a tie going to the next facing", () => {
		const f = facings(4);
		expect(facingIndex(0, f)).toBe(0);
		expect(facingIndex(44.9, f)).toBe(0);
		expect(facingIndex(45, f)).toBe(1);
		expect(facingIndex(270, f)).toBe(3);
		expect(facingIndex(314.9, f)).toBe(3);
		expect(facingIndex(315, f)).toBe(0);
	});

	it("picks the nearest of 8, wrapping at 360 / 0", () => {
		const f = facings(8);
		expect(facingIndex(0, f)).toBe(0);
		expect(facingIndex(22.4, f)).toBe(0);
		expect(facingIndex(22.5, f)).toBe(1);
		expect(facingIndex(45, f)).toBe(1);
		expect(facingIndex(270, f)).toBe(6);
		expect(facingIndex(337.4, f)).toBe(7);
		expect(facingIndex(337.5, f)).toBe(0);
		expect(facingIndex(359.99, f)).toBe(0);
		expect(facingIndex(360, f)).toBe(0);
		expect(facingIndex(-22.5, f)).toBe(0);
		expect(facingIndex(-22.6, f)).toBe(7);
		expect(facingIndex(720 + 90, f)).toBe(2);
	});

	it("picks the nearest of 16", () => {
		const f = facings(16);
		expect(facingIndex(11.2, f)).toBe(0);
		expect(facingIndex(11.25, f)).toBe(1);
		expect(facingIndex(22.5, f)).toBe(1);
		expect(facingIndex(270, f)).toBe(12);
		expect(facingIndex(348.7, f)).toBe(15);
		expect(facingIndex(348.75, f)).toBe(0);
	});

	it("honours zeroDeg and the winding", () => {
		expect(facingIndex(90, facings(8, 90))).toBe(0);
		expect(facingIndex(0, facings(8, 90))).toBe(6);
		expect(facingIndex(135, facings(8, 90))).toBe(1);
		// clockwise: facing 1 points at -45 (= 315)
		expect(facingIndex(315, facings(8, 0, false))).toBe(1);
		expect(facingIndex(90, facings(8, 0, false))).toBe(6);
		expect(facingIndex(270, facings(8, 0, false))).toBe(2);
		// a tie goes to the next facing in row order: clockwise, 337.5 is between facing 0 (0) and 1 (315)
		expect(facingIndex(337.5, facings(8, 0, false))).toBe(1);
		expect(facingIndex(22.5, facings(8, 0, false))).toBe(0);
		expect(facingIndex(22.5 + 10, facings(8, 10))).toBe(1);
	});

	it("puts the world axes at yaw 45 on the 8-facing diagonals and the 16-facing rows next to them", () => {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		const at = (x: number, z: number, f: SpriteFacings) => facingIndex(screenAngleFromBasis(x, z, basis), f);
		expect([at(1, 0, facings(8)), at(0, 1, facings(8)), at(-1, 0, facings(8)), at(0, -1, facings(8))]).toEqual([
			7, 5, 3, 1,
		]);
		// 39.3 is nearer 45 (row 2) than 22.5 (row 1) of 16
		expect([at(1, 0, facings(16)), at(0, -1, facings(16))]).toEqual([14, 2]);
	});
});

// ---------------------------------------------------------------------------------------------

function playerInput(over: Partial<PlayerSpriteInput>): PlayerSpriteInput {
	return { dead: false, rollTicks: 0, hurtTicks: 0, swing: undefined, speed: 0, alpha: 0, ...over };
}

function actorInput(over: Partial<ActorSpriteInput>): ActorSpriteInput {
	return {
		alive: true,
		deadTicks: 0,
		corpseTicks: CORPSE_TICKS,
		flashTicks: 0,
		attack: undefined,
		speed: 0,
		refSpeed: SWARMER.data.speed,
		alpha: 0,
		...over,
	};
}

describe("choosePlayerAnim", () => {
	const everything = playerInput({
		dead: true,
		rollTicks: 10,
		hurtTicks: 30,
		swing: { index: 2, progress: 0.25 },
		speed: PLAYER_SPEED,
	});

	it("follows death > roll > attack > hit > run > idle", () => {
		expect(choosePlayerAnim(everything, KNIGHT)).toEqual({ anim: "death", rate: 1 });
		const alive = { ...everything, dead: false };
		expect(choosePlayerAnim(alive, KNIGHT)).toEqual({
			anim: "roll",
			progress: (ROLL_TICKS - 10) / ROLL_TICKS,
			rate: 1,
		});
		expect(choosePlayerAnim({ ...alive, rollTicks: 0 }, KNIGHT)).toEqual({
			anim: "attack.2",
			progress: 0.25,
			rate: 1,
		});
		expect(choosePlayerAnim({ ...alive, rollTicks: 0, swing: undefined }, KNIGHT)).toEqual({
			anim: "hit",
			progress: (HURT_INVULN_TICKS - 30) / SPRITE_VIEW.playerHitTicks,
			rate: 1,
		});
		expect(choosePlayerAnim({ ...alive, rollTicks: 0, swing: undefined, hurtTicks: 0 }, KNIGHT)).toEqual({
			anim: "run",
			rate: 1,
		});
		expect(choosePlayerAnim(playerInput({}), KNIGHT)).toEqual({ anim: "idle", rate: 1 });
	});

	it("stretches the roll over ROLL_TICKS from its start tick, interpolated", () => {
		expect(choosePlayerAnim(playerInput({ rollTicks: ROLL_TICKS }), KNIGHT).progress).toBe(0);
		expect(choosePlayerAnim(playerInput({ rollTicks: ROLL_TICKS, alpha: 0.5 }), KNIGHT).progress).toBe(
			0.5 / ROLL_TICKS,
		);
		expect(choosePlayerAnim(playerInput({ rollTicks: 1, alpha: 1 }), KNIGHT).progress).toBe(1);
	});

	it("scales the run loop's rate by speed / walk speed, clamped; idle below the move threshold", () => {
		const rate = (speed: number) => choosePlayerAnim(playerInput({ speed }), KNIGHT);
		expect(SPRITE_VIEW.playerRunRefSpeed).toBe(PLAYER_SPEED);
		expect(rate(PLAYER_SPEED / 2)).toEqual({ anim: "run", rate: 0.5 });
		expect(rate(9)).toEqual({ anim: "run", rate: 1.5 });
		expect(rate(30)).toEqual({ anim: "run", rate: SPRITE_VIEW.loopRateMax });
		expect(rate(1.2)).toEqual({ anim: "run", rate: SPRITE_VIEW.loopRateMin });
		expect(rate(0.5)).toEqual({ anim: "idle", rate: 1 });
	});

	it("skips animations the set lacks, ending at idle", () => {
		const noRollAnims: Record<string, SpriteAnimationDef> = {
			idle: KNIGHT_ANIMS.idle,
			run: KNIGHT_ANIMS.run,
			hit: KNIGHT_ANIMS.hit,
			death: KNIGHT_ANIMS.death,
			"attack.1": KNIGHT_ANIMS["attack.1"],
		};
		const noRoll = source(noRollAnims);
		const rolling = playerInput({ rollTicks: 5, swing: { index: 2, progress: 0.5 }, hurtTicks: 40 });
		expect(choosePlayerAnim(rolling, noRoll).anim).toBe("hit"); // no roll, no attack.2, no generic attack
		expect(choosePlayerAnim(rolling, source({ ...noRollAnims, attack: anim(4, 10, false) })).anim).toBe("attack");
		expect(choosePlayerAnim(playerInput({ dead: true }), source({ idle: KNIGHT_ANIMS.idle }))).toEqual({
			anim: "idle",
			rate: 1,
		});
		expect(choosePlayerAnim(playerInput({ speed: PLAYER_SPEED }), source({}))).toEqual({ anim: "idle", rate: 1 });
	});
});

describe("swordSwing", () => {
	const T = SWORD_TIMING;

	it("reads its timings from SWORD_DATA", () => {
		expect(T).toEqual({
			swingTicks: SWORD_DATA.swingRecoveryTicks,
			windupTicks: SWORD_DATA.finisherWindupTicks,
			finisherTicks: SWORD_DATA.finisherRecoveryTicks,
		});
	});

	it("scales the recoveries with the player's Swift Strikes (attackTicks), not the wind-up", () => {
		const neutral = { run: undefined } as unknown as SimState;
		expect(swordTimingOf(neutral, 0)).toBe(SWORD_TIMING);
		const swift = {
			run: { players: [{ mods: { attackTicksPercent: ATTACK_TICKS_BOON_PERCENT } }] },
		} as unknown as SimState;
		expect(swordTimingOf(swift, 0)).toEqual({
			swingTicks: attackTicks(swift, 0, SWORD_DATA.swingRecoveryTicks),
			windupTicks: SWORD_DATA.finisherWindupTicks,
			finisherTicks: attackTicks(swift, 0, SWORD_DATA.finisherRecoveryTicks),
		});
		expect(swordTimingOf(swift, 0).swingTicks).toBeLessThan(SWORD_DATA.swingRecoveryTicks);
	});

	it("stretches swings 1 and 2 over their recovery from the swing tick", () => {
		expect(swordSwing(101, 0, -1, 1, -1)).toBe(undefined);
		expect(swordSwing(101, 0, 100, 0, -1)).toBe(undefined);
		expect(swordSwing(101, 0, 100, 1, -1)).toEqual({ index: 1, progress: 0 });
		expect(swordSwing(107, 0.5, 100, 2, -1)).toEqual({ index: 2, progress: 6.5 / T.swingTicks });
		expect(swordSwing(100 + T.swingTicks, 0.999, 100, 1, -1)?.index).toBe(1);
		expect(swordSwing(101 + T.swingTicks, 0, 100, 1, -1)).toBe(undefined);
	});

	it("runs the finisher as wind-up then recovery, continuous across the strike", () => {
		const total = T.windupTicks + T.finisherTicks;
		expect(swordSwing(50, 0, -1, 0, T.windupTicks)).toEqual({ index: 3, progress: 0 });
		expect(swordSwing(50, 0.25, 30, 2, 5)).toEqual({ index: 3, progress: (T.windupTicks - 4.75) / total });
		expect(swordSwing(50, 1, 30, 2, 1)).toEqual({ index: 3, progress: T.windupTicks / total });
		expect(swordSwing(101, 0, 100, 3, -1)).toEqual({ index: 3, progress: T.windupTicks / total });
		expect(swordSwing(121, 0.5, 100, 3, -1)).toEqual({ index: 3, progress: (T.windupTicks + 20.5) / total });
		expect(swordSwing(101 + T.finisherTicks, 0, 100, 3, -1)).toBe(undefined);
	});

	it("reads the sword's slots out of the weapon sets", () => {
		const SWORD = 7;
		const slot = (weapon: number) => ({ weapon, cooldown: 0, v: table.create(WEAPON_SCRATCH_SLOTS, 0) });
		const w: WeaponsState = {
			activeSet: 1,
			prevButtons: 0,
			emitterId: 0,
			sets: [slot(3), slot(SWORD)],
			swingTick: 100,
			swingX: 0,
			swingZ: 0,
			swingDirX: 1,
			swingDirZ: 0,
			swingRadius: 1,
			swingHalfCos: 0.5,
		};
		w.sets[1].v[SWORD_V_LAST] = 2;
		expect(swordSwingOf(103, 0, w, SWORD)).toEqual({ index: 2, progress: 2 / SWORD_DATA.swingRecoveryTicks });
		w.sets[1].v[SWORD_V_STEP] = SWORD_STEP_WINDUP;
		w.sets[1].v[SWORD_V_BUSY] = SWORD_DATA.finisherWindupTicks;
		expect(swordSwingOf(103, 0, w, SWORD)).toEqual({ index: 3, progress: 0 });
		w.activeSet = 0; // the bow (or anything else) in hand: no wind-up, only the last swing's tail
		expect(swordSwingOf(103, 0, w, SWORD)?.index).toBe(2);
		expect(swordSwingOf(103, 0, w, NO_WEAPON + 100)).toBe(undefined);
		w.sets[0].weapon = NO_WEAPON; // an empty slot never counts as the sword
		expect(swordSwingOf(103, 0, w, NO_WEAPON)).toBe(undefined);
		w.sets[0].weapon = 3;

		const p = newPlayerState(0, 0);
		p.x = 0.1;
		p.rollTicks = 4;
		p.hurtTicks = 9;
		expect(playerSpriteInput(p, w, 103, 0.5, SWORD)).toEqual({
			dead: false,
			rollTicks: 4,
			hurtTicks: 9,
			swing: { index: 2, progress: 2.5 / SWORD_DATA.swingRecoveryTicks },
			speed: tickSpeed(0, 0, 0.1, 0),
			alpha: 0.5,
		});
	});
});

describe("chooseActorAnim (swarmer)", () => {
	it("follows death > attack > hit > move > idle", () => {
		const attack = { elapsed: 10, total: 40 };
		const all = actorInput({ alive: false, deadTicks: 15, flashTicks: 3, attack, speed: 4.2 });
		expect(chooseActorAnim(all, SKELETON)).toEqual({
			anim: "death",
			progress: 15 / (CORPSE_TICKS * SPRITE_VIEW.deathCorpseFraction),
			rate: 1,
		});
		const alive = { ...all, alive: true };
		expect(chooseActorAnim(alive, SKELETON)).toEqual({ anim: "attack", progress: 0.25, rate: 1 });
		const realHit = source({ ...SKELETON_ANIMS, hit: anim(4, 12, false) });
		expect(chooseActorAnim({ ...alive, attack: undefined }, realHit)).toEqual({
			anim: "hit",
			progress: (HIT_FLASH_TICKS - 3) / HIT_FLASH_TICKS,
			rate: 1,
		});
		expect(chooseActorAnim({ ...alive, attack: undefined, flashTicks: 0 }, SKELETON)).toEqual({
			anim: "move",
			rate: 1,
		});
		expect(chooseActorAnim(actorInput({}), SKELETON)).toEqual({ anim: "idle", rate: 1 });
	});

	it("lets a 1-frame hit stand-in fall through to move / idle (the tint shows the hit)", () => {
		expect(SKELETON_ANIMS.hit.frames).toBe(1);
		expect(chooseActorAnim(actorInput({ flashTicks: 3, speed: SWARMER.data.speed }), SKELETON)).toEqual({
			anim: "move",
			rate: 1,
		});
		expect(chooseActorAnim(actorInput({ flashTicks: 3 }), SKELETON)).toEqual({ anim: "idle", rate: 1 });
		const twoFrames = source({ ...SKELETON_ANIMS, hit: anim(2, 12, false) });
		expect(chooseActorAnim(actorInput({ flashTicks: HIT_FLASH_TICKS }), twoFrames)).toEqual({
			anim: "hit",
			progress: 0,
			rate: 1,
		});
	});

	it("scales the move loop by speed / the swarmer's walk speed", () => {
		expect(SPRITE_VIEW.swarmerMoveRefSpeed).toBe(SWARMER.data.speed);
		expect(chooseActorAnim(actorInput({ speed: SWARMER.data.speed / 2 }), SKELETON)).toEqual({
			anim: "move",
			rate: 0.5,
		});
		expect(chooseActorAnim(actorInput({ speed: 0.1 }), SKELETON).anim).toBe("idle");
	});

	it("plays death once at its fps for a zero corpse time, idle without a death animation", () => {
		expect(chooseActorAnim(actorInput({ alive: false, corpseTicks: 0 }), SKELETON)).toEqual({
			anim: "death",
			rate: 1,
		});
		expect(chooseActorAnim(actorInput({ alive: false }), source({ idle: SKELETON_ANIMS.idle }))).toEqual({
			anim: "idle",
			rate: 1,
		});
	});

	it("times the attack as wind-up then lunge (aiTicks counting down)", () => {
		const d = SWARMER.data;
		const total = d.lungeTelegraphTicks + d.lungeTicks;
		expect(swarmerAttack(AiState.TELEGRAPH, d.lungeTelegraphTicks, 0)).toEqual({ elapsed: 0, total });
		expect(swarmerAttack(AiState.TELEGRAPH, 1, 1)).toEqual({ elapsed: d.lungeTelegraphTicks, total });
		expect(swarmerAttack(SWARMER_LUNGE, d.lungeTicks, 0)).toEqual({ elapsed: d.lungeTelegraphTicks, total });
		expect(swarmerAttack(SWARMER_LUNGE, 1, 1)).toEqual({ elapsed: total, total });
		expect(swarmerAttack(SWARMER_RECOVER, 5, 0)).toBe(undefined);
		expect(swarmerAttack(AiState.IDLE, 0, 0)).toBe(undefined);
	});

	it("fills its input from an ActorState", () => {
		const a: ActorState = {
			id: 3,
			kind: 0,
			spawnTick: -1,
			x: 1.07,
			z: 2,
			prevX: 1,
			prevZ: 2,
			faceX: 1,
			faceZ: 0,
			hp: 2,
			hpMax: 2,
			radius: SWARMER.data.radius,
			alive: 1,
			deadTicks: 0,
			aiState: AiState.TELEGRAPH,
			aiTicks: 20,
			attack: 1,
			cooldown: 0,
			flashTicks: 2,
			emitterId: 0,
			phase: 0,
			capBucket: -1,
			capWindow: table.create(DAMAGE_CAP_BUCKETS, 0),
			v: table.create(ACTOR_SCRATCH_SLOTS, 0),
		};
		expect(swarmerSpriteInput(a, 0.5)).toEqual({
			alive: true,
			deadTicks: 0,
			corpseTicks: SWARMER.data.corpseTicks ?? CORPSE_TICKS,
			flashTicks: 2,
			attack: swarmerAttack(AiState.TELEGRAPH, 20, 0.5),
			speed: tickSpeed(1, 2, 1.07, 2),
			refSpeed: SWARMER.data.speed,
			alpha: 0.5,
		});
		a.alive = 0;
		expect(swarmerSpriteInput(a, 0).attack).toBe(undefined);
	});
});

describe("tickSpeed", () => {
	it("is one tick's displacement times SIM_HZ", () => {
		expect(tickSpeed(0, 0, 0.3, 0.4)).toBe(math.sqrt(0.3 * 0.3 + 0.4 * 0.4) * 60);
		expect(tickSpeed(5, 5, 5, 5)).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------

describe("frames", () => {
	it("stretches a one-shot: floor(progress * frames), last frame held", () => {
		expect(stretchedFrame(0, 6)).toBe(0);
		expect(stretchedFrame(0.5, 6)).toBe(3);
		expect(stretchedFrame(0.999, 6)).toBe(5);
		expect(stretchedFrame(1, 6)).toBe(5);
		expect(stretchedFrame(1.7, 6)).toBe(5);
		expect(stretchedFrame(-0.2, 6)).toBe(0);
		expect(stretchedFrame(0 / 0, 6)).toBe(0);
		expect(stretchedFrame(0.9, 1)).toBe(0);
		expect(stretchedFrame(0.9, 0)).toBe(0);
	});

	it("shows a stretched choice's frame whatever the clock", () => {
		const f = spriteFrame(KNIGHT, { anim: "roll", progress: 0.5, rate: 1 }, { anim: "roll", phase: 4 }, 1);
		expect(f).toEqual({ anim: "roll", phase: 0, frame: 3 });
	});

	it("advances loops by fps * rate and wraps them", () => {
		const run = { anim: "run", rate: 1 };
		expect(spriteFrame(KNIGHT, run, undefined, 0.25)).toEqual({ anim: "run", phase: 0, frame: 0 });
		expect(spriteFrame(KNIGHT, run, { anim: "idle", phase: 3 }, 0.25)).toEqual({ anim: "run", phase: 0, frame: 0 });
		expect(spriteFrame(KNIGHT, run, { anim: "run", phase: 0 }, 0.25)).toEqual({ anim: "run", phase: 3, frame: 3 });
		expect(spriteFrame(KNIGHT, { anim: "run", rate: 0.5 }, { anim: "run", phase: 0 }, 0.25)).toEqual({
			anim: "run",
			phase: 1.5,
			frame: 1,
		});
		expect(spriteFrame(KNIGHT, run, { anim: "run", phase: 7 }, 0.25)).toEqual({ anim: "run", phase: 2, frame: 2 });
		expect(spriteFrame(KNIGHT, run, { anim: "run", phase: 7 }, -1)).toEqual({ anim: "run", phase: 7, frame: 7 });
	});

	it("holds a clock-driven one-shot's last frame", () => {
		const death = { anim: "death", rate: 1 };
		expect(spriteFrame(KNIGHT, death, { anim: "death", phase: 8 }, 0.05)).toEqual({
			anim: "death",
			phase: 8.5,
			frame: 8,
		});
		expect(spriteFrame(KNIGHT, death, { anim: "death", phase: 8 }, 0.5)).toEqual({
			anim: "death",
			phase: 10,
			frame: 9,
		});
	});

	it("shows frame 0 of an animation the set lacks", () => {
		expect(spriteFrame(source({}), { anim: "idle", rate: 1 }, { anim: "idle", phase: 3 }, 1)).toEqual({
			anim: "idle",
			phase: 0,
			frame: 0,
		});
	});
});

describe("spriteBillboard", () => {
	const cot = (deg: number) => math.cos(degToRad(deg)) / math.sin(degToRad(deg));

	it("sizes by frame / pixelsPerTile * studsPerTile and lifts the centre so the pivot sits on the feet", () => {
		const a = spriteBillboard({ frameW: 128, frameH: 128, pivot: { x: 64, y: 104 }, pixelsPerTile: 64 }, 4);
		expect([a.w, a.h, a.offsetX, a.offsetY]).toEqual([8, 8, 0, 2.5]);
		const b = spriteBillboard({ frameW: 88, frameH: 97, pivot: { x: 40, y: 90 }, pixelsPerTile: 32 }, 4, 0.5);
		expect([b.w, b.h, b.offsetX, b.offsetY]).toEqual([11, 12.125, 0.5, 5.1875]);
		expect(SPRITE_VIEW.depthBiasStuds).toBe(0);
	});

	it("shifts toward the camera by (height below the pivot) * cot(pitch) + margin, plus the depth bias", () => {
		const m = SPRITE_VIEW.floorClearanceMarginStuds;
		// 24 px below the pivot at 16 px per stud: 1.5 studs.
		const a = spriteBillboard({ frameW: 128, frameH: 128, pivot: { x: 64, y: 104 }, pixelsPerTile: 64 }, 4);
		expect(a.offsetZ).toBeCloseTo(1.5 * cot(CAMERA_PITCH_DEG) + m, 12);
		expect(floorClearanceStuds(1.5)).toBe(a.offsetZ);
		const b = spriteBillboard({ frameW: 88, frameH: 97, pivot: { x: 40, y: 90 }, pixelsPerTile: 32 }, 4, 0.5);
		expect(b.offsetZ).toBeCloseTo(7 * 0.125 * cot(CAMERA_PITCH_DEG) + m + 0.5, 12);
		// Nothing below the pivot: no clearance (only the bias); a top-down camera needs only the margin.
		expect(spriteBillboard({ frameW: 8, frameH: 8, pivot: { x: 4, y: 8 }, pixelsPerTile: 8 }, 4).offsetZ).toBe(0);
		expect(floorClearanceStuds(2, 90)).toBeCloseTo(m, 12);
		expect(floorClearanceStuds(0)).toBe(0);
	});

	it("keeps the whole cell above the floor and the pivot on the feet, seen through the real camera", () => {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		const { right, up, forward } = basis;
		// The vale layouts (knight 128 px at 38 px per tile, pivot (67, 105); skeleton 98x74 at 29.6, pivot (42, 51)).
		for (const layout of [
			{ frameW: 128, frameH: 128, pivot: { x: 67, y: 105 }, pixelsPerTile: 38 },
			{ frameW: 98, frameH: 74, pivot: { x: 42, y: 51 }, pixelsPerTile: 29.6 },
		]) {
			const bb = spriteBillboard(layout, 4);
			const s = 4 / layout.pixelsPerTile;
			// World point of cell pixel (px, py), the feet at the origin: centre + (px - W/2) right - (py - H/2) up.
			const at = (px: number, py: number) => {
				const r = bb.offsetX + (px - layout.frameW / 2) * s;
				const u = bb.offsetY - (py - layout.frameH / 2) * s;
				const c = (i: number) => r * right[i] + u * up[i] - bb.offsetZ * forward[i];
				return [c(0), c(1), c(2)] as const;
			};
			const bottom = at(layout.frameW / 2, layout.frameH);
			expect(bottom[1]).toBeGreaterThan(0);
			expect(bottom[1]).toBeCloseTo(
				SPRITE_VIEW.floorClearanceMarginStuds * math.sin(degToRad(CAMERA_PITCH_DEG)),
				9,
			);
			// The pivot pixel projects onto the feet (screen right / up components 0).
			const pivot = at(layout.pivot.x, layout.pivot.y);
			expect(dot(pivot, right)).toBeCloseTo(0, 9);
			expect(dot(pivot, up)).toBeCloseTo(0, 9);
		}
	});
});

describe("floor and upright images", () => {
	it("sizes a floor image from the player set's texel density, depth stretched back by 1 / sin(pitch)", () => {
		const s = 4 / 38;
		expect(floorImageSize(41, 31, 38, 4, 90)).toEqual([41 * s, 31 * s]);
		const [x, z] = floorImageSize(41, 31, 38, 4);
		expect(x).toBe(41 * s);
		expect(z).toBeCloseTo((31 * s) / math.sin(degToRad(CAMERA_PITCH_DEG)), 12);
	});

	it("offsets a floor image's centre from its pivot (none for a centred pivot)", () => {
		expect(floorImageOffset(41, 31, 38)).toEqual([0, 0]);
		expect(floorImageOffset(41, 31, 38, { x: 20.5, y: 15.5 })).toEqual([0, 0]);
		const [ox, oz] = floorImageOffset(40, 30, 40, { x: 10, y: 30 }, 4, 90);
		expect([ox, oz]).toEqual([1, -1.5]);
	});

	it("stands an upright image on its bottom centre, heightTiles tall", () => {
		expect(uprightImageBillboard(8, 64, 2, undefined, 4)).toEqual({
			w: 1,
			h: 8,
			offsetX: 0,
			offsetY: 4,
			offsetZ: 0,
		});
		// The pedestal beam's own pivot (4, 100): 3 px of pad below it clear the pedestal top like a sprite.
		const beam = uprightImageBillboard(8, 103, 3, { x: 4, y: 100 }, 4);
		const s = 12 / 103;
		expect(beam.h).toBeCloseTo(12, 12);
		expect(beam.offsetY).toBeCloseTo((100 - 51.5) * s, 12);
		expect(beam.offsetZ).toBeCloseTo(floorClearanceStuds(3 * s), 12);
		const b = uprightImageBillboard(8, 103, 3, undefined, 4);
		expect(b.h).toBeCloseTo(12, 12);
		expect(b.w).toBeCloseTo((8 / 103) * 12, 12);
		expect(b.offsetY).toBeCloseTo(6, 12);
	});
});

describe("animDtSec", () => {
	it("steps by sim time, 0 on the first frame and backwards, capped", () => {
		expect(animDtSec(undefined, 5)).toBe(0);
		expect(animDtSec(1, 1.125)).toBe(0.125);
		expect(animDtSec(1, 1)).toBe(0);
		expect(animDtSec(1, 0.5)).toBe(0);
		expect(animDtSec(1, 10)).toBe(SPRITE_VIEW.maxAnimDtSec);
	});
});

describe("looks", () => {
	it("actor: flash beats the telegraph pulse; dead is normal", () => {
		const pulse = ACTOR_VIEW.telegraphPulseTicks;
		expect(actorLook(0, 5, AiState.TELEGRAPH, 0)).toBe("normal");
		expect(actorLook(1, 5, AiState.TELEGRAPH, 0)).toBe("flash");
		expect(actorLook(1, 0, AiState.TELEGRAPH, 0)).toBe("telegraph");
		expect(actorLook(1, 0, AiState.TELEGRAPH, pulse - 1)).toBe("telegraph");
		expect(actorLook(1, 0, AiState.TELEGRAPH, pulse)).toBe("normal");
		expect(actorLook(1, 0, AiState.TELEGRAPH, 2 * pulse)).toBe("telegraph");
		expect(actorLook(1, 0, AiState.IDLE, 0)).toBe("normal");
	});

	it("player: dead, i-frames, and the post-hit blink", () => {
		const b = ACTOR_VIEW.blinkTicks;
		expect(playerLook(1, 5)).toBe("dead");
		expect(playerLook(0, 5)).toBe("iframes");
		expect(playerLook(0, 0)).toBe("normal");
		expect(playerBlinkVisible(0, 0)).toBe(true);
		expect(playerBlinkVisible(0, b - 1)).toBe(true);
		expect(playerBlinkVisible(0, b)).toBe(false);
		expect(playerBlinkVisible(0, 2 * b)).toBe(true);
		expect(playerBlinkVisible(1, b)).toBe(true);
	});

	it("corpse fade over the corpse time", () => {
		expect(corpseTransparency(1, 20, 30)).toBe(0);
		expect(corpseTransparency(0, 15, 30)).toBe(0.5);
		expect(corpseTransparency(0, 45, 30)).toBe(1);
		expect(corpseTransparency(0, 0, 0)).toBe(1);
	});

	it("names a colour role per non-normal look", () => {
		expect(ACTOR_VIEW.lookRoles).toEqual({
			flash: "damageNumber",
			telegraph: "telegraph",
			iframes: "playerBullet",
			dead: "uiTextDim",
		});
	});
});

describe("ACTOR_SPRITE_INPUTS", () => {
	it("draws only the swarmer as a sprite (other archetypes stay placeholders)", () => {
		expect(ACTOR_SPRITE_INPUTS.size()).toBe(1);
		expect(ACTOR_SPRITE_INPUTS.get(SWARMER.id)).toBe(swarmerSpriteInput);
	});
});
