import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, PIXELS_PER_TILE } from "shared/config";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	generateDungeon,
	placeEncounter,
} from "shared/dungeon";
import {
	ACTOR_SCRATCH_SLOTS,
	AiState,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BOSS_TELEGRAPH_TICKS,
	BRUISER,
	BRUISER_CHASE,
	BRUISER_RECOVER,
	BossAttack,
	BossState,
	Button,
	CHARGE_IMPACT_HOLD_TICKS,
	CHARGE_SPEED,
	CLEAVE_HOLD_TICKS,
	CORPSE_TICKS,
	DEMONLORD_DATA,
	DEMONLORD_TELEGRAPH_TICKS,
	DEMONLORD_V_MARK,
	DOUBLE_CLEAVE_DELAY_TICKS,
	DOUBLE_RING_DELAY_TICKS,
	DemonlordAttack,
	DemonlordState,
	EMPTY_INPUT,
	FAN_VOLLEYS,
	FAN_VOLLEY_TICKS,
	FAST_FAN_VOLLEYS,
	FAST_FAN_VOLLEY_TICKS,
	HELLFIRE_HOLD_TICKS,
	PLAYER_RADIUS,
	SHOCK2_DELAY_TICKS,
	SIM_DT,
	SLAM_MAX_TICKS,
	SLAM_SPEED,
	SPIRAL_BURST_TICKS,
	SPIRAL_TICKS,
	SUMMON_HOLD_TICKS,
	V_AUX_X,
	V_AUX_Z,
	V_LAST,
	V_MARK,
	createSimState,
	step,
	type SimConfig,
	DAMAGE_CAP_BUCKETS,
	HIT_FLASH_TICKS,
	HURT_INVULN_TICKS,
	NO_WEAPON,
	PLAYER_SPEED,
	ROLL_TICKS,
	SIM_HZ,
	SNIPER,
	SNIPER_REPOSITION,
	SQRT1_2,
	SWARMER,
	SWARMER_LUNGE,
	SWARMER_RECOVER,
	SWORD_DATA,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	TURRET_RESPAWN_TICKS,
	TURRET_SNIPER,
	WEAPON_SCRATCH_SLOTS,
	newPlayerState,
	ATTACK_TICKS_BOON_PERCENT,
	attackTicks,
	type ActorState,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import {
	BOSS,
	PLACEHOLDER_MANIFEST,
	THEME_PACKS,
	listThemePacks,
	loadThemePack,
	optionalBaseAnimations,
	requiredBaseAnimations,
	type SpriteAnimationDef,
	type SpriteFacings,
	type ThemeManifest,
} from "shared/theme";
import { VALE_SPRITE_LAYOUTS, buildValeManifest } from "shared/theme/packs/vale";
import {
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	SPRITE_ANIM_MARKS,
	SPRITE_VIEW,
	bossAct1Attack,
	bossAct1AttackAnim,
	bossAct1Special,
	bossAct1SpriteInput,
	bruiserAttack,
	bruiserSpriteInput,
	segmentFrame,
	segmentLength,
	segmentStart,
	actorLook,
	animDtSec,
	bossSpriteLayout,
	corpseTransparency,
	demonlordAttack,
	demonlordSpecial,
	demonlordSpriteInput,
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
	sniperAttack,
	sniperSpriteInput,
	turretSniperSpriteInput,
	turretSpriteInputOf,
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
	type SpriteAnimChoice,
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

/** A live ActorState at rest (fields overridden per case). */
function actorState(over: Partial<ActorState>): ActorState {
	return {
		id: 1,
		kind: 0,
		spawnTick: -1,
		x: 0,
		z: 0,
		prevX: 0,
		prevZ: 0,
		faceX: 1,
		faceZ: 0,
		hp: 4,
		hpMax: 4,
		radius: SNIPER.data.radius,
		alive: 1,
		deadTicks: 0,
		aiState: SNIPER_REPOSITION,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: table.create(DAMAGE_CAP_BUCKETS, 0),
		v: table.create(ACTOR_SCRATCH_SLOTS, 0),
		...over,
	};
}

describe("chooseActorAnim (sniper)", () => {
	const d = SNIPER.data;
	const total = d.telegraphTicks;

	it("times the attack over the line's telegraph (aiTicks counting down, no lunge)", () => {
		// ctx.telegraph sets aiTicks = telegraphTicks; telegraphing() decrements it and fires at 0.
		expect(sniperAttack(AiState.TELEGRAPH, total, 0)).toEqual({ elapsed: 0, total });
		expect(sniperAttack(AiState.TELEGRAPH, d.lockTicks, 0)).toEqual({ elapsed: total - d.lockTicks, total });
		expect(sniperAttack(AiState.TELEGRAPH, 1, 1)).toEqual({ elapsed: total, total });
		expect(sniperAttack(AiState.TELEGRAPH, total, 0.5)).toEqual({ elapsed: 0.5, total });
	});

	it("is not attacking while repositioning, calm or leashing", () => {
		expect(sniperAttack(SNIPER_REPOSITION, 20, 0.5)).toBe(undefined);
		expect(sniperAttack(AiState.IDLE, 0, 0)).toBe(undefined);
		const dead = actorState({ alive: 0, deadTicks: 4, aiState: AiState.TELEGRAPH, aiTicks: 10 });
		expect(sniperSpriteInput(dead, 0).attack).toBe(undefined);
	});

	it("fills its input from an ActorState", () => {
		const a = actorState({ x: 1.04, prevX: 1, aiState: AiState.TELEGRAPH, aiTicks: 20, flashTicks: 2 });
		expect(SPRITE_VIEW.sniperMoveRefSpeed).toBe(d.speed);
		expect(sniperSpriteInput(a, 0.5)).toEqual({
			alive: true,
			deadTicks: 0,
			corpseTicks: d.corpseTicks ?? CORPSE_TICKS,
			flashTicks: 2,
			attack: sniperAttack(AiState.TELEGRAPH, 20, 0.5),
			speed: tickSpeed(1, 0, 1.04, 0),
			refSpeed: d.speed,
			alpha: 0.5,
		});
	});

	it("plays attack while telegraphing, move while strafing, idle calm, death dead", () => {
		const strafeStep = d.speed / SIM_HZ;
		const telegraphing = actorState({ aiState: AiState.TELEGRAPH, aiTicks: d.lockTicks });
		expect(chooseActorAnim(sniperSpriteInput(telegraphing, 0), SKELETON)).toEqual({
			anim: "attack",
			progress: (total - d.lockTicks) / total,
			rate: 1,
		});
		const strafing = actorState({ aiState: SNIPER_REPOSITION, aiTicks: 30, prevX: 0, x: strafeStep });
		const move = chooseActorAnim(sniperSpriteInput(strafing, 0), SKELETON);
		expect(move.anim).toBe("move");
		expect(move.progress).toBe(undefined);
		expect(move.rate).toBeCloseTo(1, 9);
		expect(chooseActorAnim(sniperSpriteInput(actorState({ aiState: AiState.IDLE }), 0), SKELETON)).toEqual({
			anim: "idle",
			rate: 1,
		});
		const dead = actorState({ alive: 0, deadTicks: 6, aiState: AiState.TELEGRAPH, aiTicks: 10 });
		expect(chooseActorAnim(sniperSpriteInput(dead, 0), SKELETON)).toEqual({
			anim: "death",
			progress: 6 / ((d.corpseTicks ?? CORPSE_TICKS) * SPRITE_VIEW.deathCorpseFraction),
			rate: 1,
		});
	});
});

describe("chooseActorAnim (turret)", () => {
	const corpseTicks = TURRET_SNIPER.data.corpseTicks ?? CORPSE_TICKS;

	it("never attacks or moves, even mid-burst or when displaced", () => {
		const a = actorState({ aiState: AiState.TELEGRAPH, aiTicks: 5, cooldown: 1, prevX: 0, x: 1 });
		const input = turretSniperSpriteInput(a, 0.5);
		expect(input.attack).toBe(undefined);
		expect(input.speed).toBe(0);
		expect(input.refSpeed).toBe(0);
		expect(chooseActorAnim(input, SKELETON)).toEqual({ anim: "idle", rate: 1 });
	});

	it("is a corpse while dead and a live idle body once respawned", () => {
		const dead = actorState({ alive: 0, deadTicks: 3 });
		const deadInput = turretSniperSpriteInput(dead, 0);
		expect(deadInput.corpseTicks).toBe(corpseTicks);
		expect(chooseActorAnim(deadInput, SKELETON).anim).toBe("death");
		// turretStepDead revives at TURRET_RESPAWN_TICKS: reviveActor sets alive = 1, deadTicks = 0.
		expect(TURRET_RESPAWN_TICKS).toBeGreaterThan(corpseTicks);
		const respawned = actorState({ alive: 1, deadTicks: 0, hp: TURRET_SNIPER.data.hp });
		const input = turretSniperSpriteInput(respawned, 0);
		expect(input.alive).toBe(true);
		expect(chooseActorAnim(input, SKELETON)).toEqual({ anim: "idle", rate: 1 });
		expect(corpseTransparency(respawned.alive, respawned.deadTicks, input.corpseTicks)).toBe(0);
	});

	it("builds from any turret's data (the corpse time it carries)", () => {
		const build = turretSpriteInputOf({ ...TURRET_SNIPER.data, corpseTicks: 12 });
		expect(build(actorState({ alive: 0, deadTicks: 1 }), 0).corpseTicks).toBe(12);
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

	it("a boss sprite's corpse holds until fadeFrom of the corpse time, then fades over the rest", () => {
		expect(corpseTransparency(0, 15, 30, 0)).toBe(corpseTransparency(0, 15, 30));
		expect(corpseTransparency(0, 18, 30, 0.6)).toBe(0);
		expect(corpseTransparency(0, 24, 30, 0.6)).toBeCloseTo(0.5, 12);
		expect(corpseTransparency(0, 30, 30, 0.6)).toBe(1);
		expect(corpseTransparency(1, 30, 30, 0.6)).toBe(0);
		expect(corpseTransparency(0, 29, 30, 1)).toBe(0);
		expect(corpseTransparency(0, 30, 30, 1)).toBe(1);
		expect(SPRITE_VIEW.bossCorpseFadeFrom).toBe(SPRITE_VIEW.bossDeathCorpseFraction);
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

// ---------------------------------------------------------------------------------------------
// Segments (docs/BRAMBLE_ART.md BR4: wind-up / release parts of one animation)

describe("animation segments", () => {
	it("resolve fractions to frames for any frame count, at least one frame, clamped to the animation", () => {
		const half = { from: 0.5, to: 1 };
		expect([segmentStart(half, 6), segmentLength(half, 6)]).toEqual([3, 3]);
		expect([segmentStart(half, 8), segmentLength(half, 8)]).toEqual([4, 4]);
		expect([segmentStart({ from: 0, to: 0.5 }, 6), segmentLength({ from: 0, to: 0.5 }, 6)]).toEqual([0, 3]);
		expect([segmentStart({ from: 1, to: 1 }, 6), segmentLength({ from: 1, to: 1 }, 6)]).toEqual([5, 1]);
		expect([segmentStart({ from: 0.5, to: 0.5 }, 6), segmentLength({ from: 0.5, to: 0.5 }, 6)]).toEqual([3, 1]);
		expect([segmentStart({ from: -1, to: 2 }, 4), segmentLength({ from: -1, to: 2 }, 4)]).toEqual([0, 4]);
		expect([segmentStart({ from: 0 / 0, to: 0 / 0 }, 4), segmentLength({ from: 0 / 0, to: 0 / 0 }, 4)]).toEqual([
			0, 4,
		]);
		expect([segmentStart(half, 1), segmentLength(half, 1)]).toEqual([0, 1]);
	});

	it("stretch the progress over the segment's frames only; no segment is the whole animation", () => {
		const release = { from: 0.5, to: 1 };
		expect([0, 0.34, 0.67, 0.99, 1, 2].map((p) => segmentFrame(p, 6, release))).toEqual([3, 4, 5, 5, 5, 5]);
		const windup = { from: 0, to: 0.5 };
		expect([0, 0.34, 0.67, 1].map((p) => segmentFrame(p, 6, windup))).toEqual([0, 1, 2, 2]);
		expect([0, 0.5, 1].map((p) => segmentFrame(p, 6))).toEqual([0, 3, 5]);
		const set = source({ a: anim(6, 10, false) });
		const choice: SpriteAnimChoice = { anim: "a", progress: 0, rate: 1, segment: release };
		expect(spriteFrame(set, choice, undefined, 0).frame).toBe(3);
	});
});

// ---------------------------------------------------------------------------------------------
// Bruiser (docs/DEMON_ART.md DA4)

/** Demon Beast 3's slots (art/atlases.json enemy.bruiser): idle 4, walk 8, Attack 4 (leap and slam) 8, TakeDamage 4, Die 6. */
const BEAST_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(4, 6, true),
	move: anim(8, 10, true),
	attack: anim(8, 12, false),
	hit: anim(4, 12, false),
	death: anim(6, 10, false),
};
const BEAST = source(BEAST_ANIMS);

describe("chooseActorAnim (bruiser)", () => {
	const d = BRUISER.data;
	const M = SPRITE_ANIM_MARKS.bruiser;
	const frames = BEAST_ANIMS.attack.frames;
	const impact = math.round(M.impact * frames);
	const follow = math.round(M.followThrough * frames);
	const pick = (a: ActorState, alpha = 0) => {
		const p = spriteFrame(BEAST, chooseActorAnim(bruiserSpriteInput(a, alpha), BEAST), undefined, 0);
		return [p.anim, p.frame];
	};

	it("splits the slam into a leap, an impact and a follow-through, each non-empty, the impact inside the recover", () => {
		expect(impact).toBeGreaterThan(0);
		expect(follow).toBeGreaterThan(impact);
		expect(follow).toBe(frames - 1); // one frame: held
		expect(M.impactTicks).toBeGreaterThan(0);
		expect(M.impactTicks).toBeLessThan(d.recoverTicks);
	});

	it("leaps over the telegraph, shows the impact frame on the slam tick and holds the follow-through over the recover", () => {
		// ctx.telegraph sets aiTicks = telegraphTicks; the telegraph's last tick is aiTicks 1. slam() fires and enters
		// BRUISER_RECOVER with aiTicks = recoverTicks on the tick the telegraph runs out; its last tick is aiTicks 1.
		const T = d.telegraphTicks;
		const R = d.recoverTicks;
		const I = M.impactTicks;
		expect(bruiserAttack(AiState.TELEGRAPH, T, 0)).toEqual({
			segment: { from: 0, to: M.impact },
			elapsed: 0,
			total: T,
		});
		expect(pick(actorState({ aiState: AiState.TELEGRAPH, aiTicks: T }))).toEqual(["attack", 0]);
		expect(pick(actorState({ aiState: AiState.TELEGRAPH, aiTicks: 1 }))).toEqual(["attack", impact - 1]);
		expect(pick(actorState({ aiState: AiState.TELEGRAPH, aiTicks: 1 }), 0.99)).toEqual(["attack", impact - 1]);
		// the slam tick and the impact ticks after it
		expect(bruiserAttack(BRUISER_RECOVER, R, 0)).toEqual({
			segment: { from: M.impact, to: M.followThrough },
			elapsed: 0,
			total: I,
		});
		expect(pick(actorState({ aiState: BRUISER_RECOVER, aiTicks: R }))).toEqual(["attack", impact]);
		expect(pick(actorState({ aiState: BRUISER_RECOVER, aiTicks: R }), 0.5)).toEqual(["attack", impact]);
		expect(pick(actorState({ aiState: BRUISER_RECOVER, aiTicks: R - (I - 1) }), 0.99)).toEqual([
			"attack",
			follow - 1,
		]);
		// then the follow-through, held to the recover's last tick
		expect(pick(actorState({ aiState: BRUISER_RECOVER, aiTicks: R - I }))).toEqual(["attack", follow]);
		for (let left = R - I; left >= 1; left--) {
			expect([left, ...pick(actorState({ aiState: BRUISER_RECOVER, aiTicks: left }), 0.5)]).toEqual([
				left,
				"attack",
				follow,
			]);
		}
		expect(bruiserAttack(BRUISER_RECOVER, 1, 1)).toEqual({
			segment: { from: M.followThrough, to: 1 },
			elapsed: R - I,
			total: R - I,
		});
	});

	it("is not attacking while walking, calm or dead", () => {
		expect(bruiserAttack(BRUISER_CHASE, 0, 0.5)).toBe(undefined);
		expect(bruiserAttack(AiState.IDLE, 0, 0)).toBe(undefined);
		const dead = actorState({ alive: 0, deadTicks: 3, aiState: AiState.TELEGRAPH, aiTicks: 10 });
		expect(bruiserSpriteInput(dead, 0).attack).toBe(undefined);
	});

	it("plays attack while telegraphing / recovering, move while walking, idle calm, death dead; hit never beats an attack", () => {
		expect(SPRITE_VIEW.bruiserMoveRefSpeed).toBe(d.speed);
		const plod = d.speed / SIM_HZ;
		const walking = actorState({ aiState: BRUISER_CHASE, prevX: 0, x: plod });
		const move = chooseActorAnim(bruiserSpriteInput(walking, 0), BEAST);
		expect([move.anim, move.progress]).toEqual(["move", undefined]);
		expect(move.rate).toBeCloseTo(1, 9);
		expect(chooseActorAnim(bruiserSpriteInput(actorState({ aiState: AiState.IDLE }), 0), BEAST)).toEqual({
			anim: "idle",
			rate: 1,
		});
		const flash = HIT_FLASH_TICKS;
		for (const st of [AiState.TELEGRAPH, BRUISER_RECOVER]) {
			const hitWhileAttacking = actorState({ aiState: st, aiTicks: 5, flashTicks: flash });
			expect(chooseActorAnim(bruiserSpriteInput(hitWhileAttacking, 0), BEAST).anim).toBe("attack");
		}
		const hitWalking = actorState({ aiState: BRUISER_CHASE, prevX: 0, x: plod, flashTicks: flash });
		expect(chooseActorAnim(bruiserSpriteInput(hitWalking, 0), BEAST).anim).toBe("hit");
		const dead = actorState({ alive: 0, deadTicks: 6, aiState: AiState.TELEGRAPH, aiTicks: 10 });
		expect(chooseActorAnim(bruiserSpriteInput(dead, 0), BEAST)).toEqual({
			anim: "death",
			progress: 6 / ((d.corpseTicks ?? CORPSE_TICKS) * SPRITE_VIEW.deathCorpseFraction),
			rate: 1,
		});
	});
});

// ---------------------------------------------------------------------------------------------
// Mother Bramble (boss.act1, docs/BRAMBLE_ART.md BR4)

/** A Demon Elite set per the BRAMBLE_ART mapping (hit = idle's cell, BD3; no `intro`: the roars play taunt). */
const ELITE_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(4, 8, true),
	move: anim(8, 10, true),
	attack: anim(6, 12, false),
	"attack.2": anim(6, 12, false),
	"attack.3": anim(6, 12, false),
	"attack.4": anim(8, 12, false),
	taunt: anim(6, 10, false),
	hit: anim(1, 1, false),
	death: anim(8, 10, false),
};
const ELITE = source(ELITE_ANIMS);
/** Only the boss slot's required animations. */
const BARE_BOSS = source({
	idle: ELITE_ANIMS.idle,
	move: ELITE_ANIMS.move,
	attack: ELITE_ANIMS.attack,
	hit: ELITE_ANIMS.hit,
	death: ELITE_ANIMS.death,
});

/** A live, engaged boss.act1 at rest on the origin (fields and v[] slots overridden per case). */
function bossState(over: Partial<ActorState>, slots: ReadonlyArray<readonly [number, number]> = []): ActorState {
	const v = table.create(ACTOR_SCRATCH_SLOTS, 0);
	for (const [slot, value] of slots) v[slot] = value;
	return actorState({
		radius: BOSS_ACT1_DATA.radius,
		hp: BOSS_ACT1_DATA.hp,
		hpMax: BOSS_ACT1_DATA.hp,
		phase: 1,
		aiState: BossState.DORMANT,
		v,
		...over,
	});
}

/** [animation, frame] the boss shows for `a` with `set`. */
function bossPick(a: ActorState, alpha = 0, set: SpriteAnimSource = ELITE): [string, number] {
	const p = spriteFrame(set, chooseActorAnim(bossAct1SpriteInput(a, alpha), set), undefined, 0);
	return [p.anim, p.frame];
}

const BOSS_D = BOSS_ACT1_DATA;
const BOSS_M = SPRITE_ANIM_MARKS.bossAct1;
const ATTACKS = [
	BossAttack.FAN,
	BossAttack.RING,
	BossAttack.DOUBLE_RING,
	BossAttack.SPIRAL,
	BossAttack.SLAM,
	BossAttack.FAST_FAN,
];
/** Each attack's first release frame in the Elite set (the slam: its first airborne frame). */
function releaseFrame(attack: number, set: Readonly<Record<string, SpriteAnimationDef>> = ELITE_ANIMS): number {
	const animName = bossAct1AttackAnim(attack)!;
	const frames = (set[animName] ?? set.attack).frames;
	const mark =
		attack === BossAttack.SLAM
			? BOSS_M.slamTakeoff
			: attack === BossAttack.SPIRAL
			? BOSS_M.spiralRelease
			: attack === BossAttack.RING || attack === BossAttack.DOUBLE_RING
			? BOSS_M.ringRelease
			: BOSS_M.fanRelease;
	return math.round(mark * frames);
}
const LANDING = math.round(BOSS_M.slamLanding * ELITE_ANIMS["attack.4"].frames);
/** The recover length act1's recover() gives an attack in `phase`. */
const recoverOf = (phase: number) => BOSS_D.recoverTicks[phase];

describe("chooseActorAnim (boss.act1)", () => {
	it("maps each attack to its animation, every one a boss slot name, with non-empty wind-up and release parts", () => {
		expect(ATTACKS.map((k) => bossAct1AttackAnim(k))).toEqual([
			"attack",
			"attack.2",
			"attack.2",
			"attack.3",
			"attack.4",
			"attack",
		]);
		expect([bossAct1AttackAnim(BossAttack.NONE), bossAct1AttackAnim(BossAttack.ROAR)]).toEqual([
			undefined,
			undefined,
		]);
		const names = [...requiredBaseAnimations(BOSS), ...optionalBaseAnimations(BOSS)];
		for (const k of ATTACKS) expect(names.includes(bossAct1AttackAnim(k)!)).toBe(true);
		for (const special of ["intro", "taunt"]) expect(names.includes(special)).toBe(true);
		for (const k of ATTACKS) {
			const f = releaseFrame(k);
			expect([k, f > 0 && f < ELITE_ANIMS[bossAct1AttackAnim(k)!].frames]).toEqual([k, true]);
		}
		expect(LANDING).toBeGreaterThan(releaseFrame(BossAttack.SLAM));
		expect(LANDING).toBeLessThan(ELITE_ANIMS["attack.4"].frames);
	});

	it("shows every state per the BRAMBLE_ART mapping", () => {
		expect(bossPick(bossState({ aiState: BossState.DORMANT, phase: 0 }))).toEqual(["idle", 0]);
		expect(bossPick(bossState({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, aiTicks: 30 }))[0]).toBe(
			"taunt",
		);
		for (const k of ATTACKS) {
			const T = BOSS_TELEGRAPH_TICKS[k];
			expect(bossPick(bossState({ aiState: BossState.TELEGRAPH, attack: k, aiTicks: T }))[0]).toBe(
				bossAct1AttackAnim(k),
			);
			expect(bossPick(bossState({ aiState: BossState.ACTIVE, attack: k, aiTicks: 0 }))[0]).toBe(
				bossAct1AttackAnim(k),
			);
		}
		expect(bossPick(bossState({ aiState: BossState.RECOVER, aiTicks: 1 }, [[V_LAST, BossAttack.FAN]]))).toEqual([
			"idle",
			0,
		]);
		const walk = BOSS_D.speed / SIM_HZ;
		const repositioning = chooseActorAnim(
			bossAct1SpriteInput(bossState({ aiState: BossState.REPOSITION, aiTicks: 100, prevX: 0, x: walk }), 0),
			ELITE,
		);
		expect([repositioning.anim, repositioning.progress]).toEqual(["move", undefined]);
		expect(repositioning.rate).toBeCloseTo(1, 9);
		expect(SPRITE_VIEW.bossAct1MoveRefSpeed).toBe(BOSS_D.speed);
		const dead = bossState({ alive: 0, deadTicks: 9, aiState: BossState.ACTIVE, attack: BossAttack.SPIRAL });
		expect(chooseActorAnim(bossAct1SpriteInput(dead, 0), ELITE)).toEqual({
			anim: "death",
			progress: 9 / ((BOSS_D.corpseTicks ?? CORPSE_TICKS) * SPRITE_VIEW.deathCorpseFraction),
			rate: 1,
		});
		const corpseEnd = bossState({ alive: 0, deadTicks: BOSS_D.corpseTicks ?? CORPSE_TICKS });
		expect(bossPick(corpseEnd)).toEqual(["death", ELITE_ANIMS.death.frames - 1]);
	});

	it("plays the intro roar over introTicks and each phase roar over transitionTicks, start to end", () => {
		const frames = ELITE_ANIMS.taunt.frames;
		const cases: Array<[number, number]> = [
			[1, BOSS_D.introTicks],
			[2, BOSS_D.transitionTicks],
			[3, BOSS_D.transitionTicks],
		];
		for (const [phase, total] of cases) {
			const roar = (aiTicks: number) =>
				bossState({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, phase, aiTicks });
			// The intro names taunt as its fallback (Elite 3 has no intro); the phase roars are taunt itself.
			expect(bossAct1Special(roar(total), 0)).toEqual(
				phase === 1
					? { anim: "intro", elapsed: 0, total, fallback: "taunt" }
					: { anim: "taunt", elapsed: 0, total },
			);
			expect(bossPick(roar(total))).toEqual(["taunt", 0]);
			expect(bossPick(roar(total / 2))).toEqual(["taunt", frames / 2]);
			expect(bossPick(roar(1))).toEqual(["taunt", frames - 1]);
			expect(bossPick(roar(1), 0.99)).toEqual(["taunt", frames - 1]);
		}
		// With an `intro`, the first roar plays it and the phase roars keep taunt.
		const withIntro = source({ ...ELITE_ANIMS, intro: anim(5, 10, false) });
		const intro = bossState({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, phase: 1, aiTicks: 1 });
		expect(bossPick(intro, 0, withIntro)).toEqual(["intro", 4]);
		expect(bossPick({ ...intro, phase: 2 }, 0, withIntro)).toEqual(["taunt", frames - 1]);
	});

	it("puts each attack's last wind-up frame on its last telegraph tick (aiTicks 1)", () => {
		for (const k of ATTACKS) {
			const T = BOSS_TELEGRAPH_TICKS[k];
			const tg = (aiTicks: number) => bossState({ aiState: BossState.TELEGRAPH, attack: k, aiTicks });
			const name = bossAct1AttackAnim(k)!;
			expect([k, ...bossPick(tg(T))]).toEqual([k, name, 0]);
			expect([k, ...bossPick(tg(1))]).toEqual([k, name, releaseFrame(k) - 1]);
			expect([k, ...bossPick(tg(1), 0.99)]).toEqual([k, name, releaseFrame(k) - 1]);
		}
	});

	it("replays the fan's release on every volley tick, the last one on the tick that enters RECOVER", () => {
		const fans: Array<[number, number, number, number]> = [
			[BossAttack.FAN, FAN_VOLLEYS, FAN_VOLLEY_TICKS, 1],
			[BossAttack.FAN, FAN_VOLLEYS, FAN_VOLLEY_TICKS, 2],
			[BossAttack.FAST_FAN, FAST_FAN_VOLLEYS, FAST_FAN_VOLLEY_TICKS, 3],
		];
		const last = ELITE_ANIMS.attack.frames - 1;
		for (const [k, volleys, every, phase] of fans) {
			const rel = releaseFrame(k);
			const active = (t: number) => bossState({ aiState: BossState.ACTIVE, attack: k, aiTicks: t, phase });
			// runAttack fires volley v on t = v * every; the attack ends (RECOVER) on the last volley's tick.
			for (let v = 0; v < volleys - 1; v++) {
				expect([k, v, ...bossPick(active(v * every))]).toEqual([k, v, "attack", rel]);
				expect([k, v, ...bossPick(active(v * every + every - 1))]).toEqual([k, v, "attack", last]);
			}
			const R = recoverOf(phase);
			const rec = (since: number) =>
				bossState({ aiState: BossState.RECOVER, aiTicks: R - since, phase }, [[V_LAST, k]]);
			expect([k, ...bossPick(rec(0))]).toEqual([k, "attack", rel]);
			expect([k, ...bossPick(rec(every - 1))]).toEqual([k, "attack", last]);
			expect([k, ...bossPick(rec(every))]).toEqual([k, "idle", 0]);
		}
	});

	it("releases on each ring: the ring's own tick (RECOVER's first), DOUBLE_RING's t = 0 and its second ring", () => {
		const rel = releaseFrame(BossAttack.RING);
		const span = BOSS_M.ringReleaseTicks;
		// RING fires on t = 0 and recovers on that same tick.
		const ring = (since: number) =>
			bossState({ aiState: BossState.RECOVER, aiTicks: recoverOf(1) - since, phase: 1 }, [
				[V_LAST, BossAttack.RING],
			]);
		expect(bossPick(ring(0))).toEqual(["attack.2", rel]);
		expect(bossPick(ring(span - 1))).toEqual(["attack.2", ELITE_ANIMS["attack.2"].frames - 1]);
		expect(bossPick(ring(span))).toEqual(["idle", 0]);
		const dr = (t: number) =>
			bossState({ aiState: BossState.ACTIVE, attack: BossAttack.DOUBLE_RING, aiTicks: t, phase: 2 });
		expect(bossPick(dr(0))).toEqual(["attack.2", rel]);
		expect(bossPick(dr(span - 1))).toEqual(["attack.2", ELITE_ANIMS["attack.2"].frames - 1]);
		expect(bossPick(dr(span))).toEqual(["attack.2", 0]);
		expect(bossPick(dr(DOUBLE_RING_DELAY_TICKS - 1))).toEqual(["attack.2", rel - 1]);
		const second = bossState({ aiState: BossState.RECOVER, aiTicks: recoverOf(2), phase: 2 }, [
			[V_LAST, BossAttack.DOUBLE_RING],
		]);
		expect(bossPick(second)).toEqual(["attack.2", rel]);
	});

	it("loops the spiral's release at its fps for the whole SPIRAL_TICKS", () => {
		const rel = releaseFrame(BossAttack.SPIRAL);
		const def = ELITE_ANIMS["attack.3"];
		const len = def.frames - rel;
		const ticksPerFrame = SIM_HZ / def.fps;
		const at = (t: number) =>
			bossPick(bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SPIRAL, aiTicks: t, phase: 2 }));
		expect(at(0)).toEqual(["attack.3", rel]);
		expect(at(ticksPerFrame)).toEqual(["attack.3", rel + 1]);
		expect(at(ticksPerFrame * len)).toEqual(["attack.3", rel]);
		for (let t = 0; t < SPIRAL_TICKS; t++) {
			const [name, frame] = at(t);
			expect([t, name, frame >= rel && frame < def.frames]).toEqual([t, "attack.3", true]);
		}
		expect(
			bossAct1Attack(bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SPIRAL, aiTicks: 7 }), 0)?.loop,
		).toBe(true);
	});

	it("crouches over the slam's telegraph, is airborne over the charge and lands on the impact tick (V_MARK)", () => {
		const takeoff = releaseFrame(BossAttack.SLAM);
		const step1 = SLAM_SPEED * SIM_DT;
		const charging = (t: number, stepsLeft: number) =>
			bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SLAM, aiTicks: t, phase: 3 }, [
				[V_MARK, 0],
				[V_AUX_X, stepsLeft * step1],
				[V_AUX_Z, 0],
			]);
		expect(bossPick(charging(0, 10))).toEqual(["attack.4", takeoff]);
		// One step from the target: the next tick is the impact, so this one is the last airborne frame.
		expect(bossPick(charging(9, 1))).toEqual(["attack.4", LANDING - 1]);
		for (let t = 0; t < SLAM_MAX_TICKS; t++) {
			const [name, frame] = bossPick(charging(t, 100), 0.99);
			expect([t, name, frame >= takeoff && frame < LANDING]).toEqual([t, "attack.4", true]);
		}
		const impactAt = 12;
		const landed = (t: number) =>
			bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SLAM, aiTicks: t, phase: 3 }, [
				[V_MARK, impactAt + 1],
			]);
		expect(bossPick(landed(impactAt))).toEqual(["attack.4", LANDING]);
		expect(bossPick(landed(impactAt), 0.99)).toEqual(["attack.4", LANDING]);
		expect(bossPick(landed(impactAt + SHOCK2_DELAY_TICKS - 1))).toEqual([
			"attack.4",
			ELITE_ANIMS["attack.4"].frames - 1,
		]);
		const after = bossState({ aiState: BossState.RECOVER, aiTicks: BOSS_D.slamRecoverTicks, phase: 3 }, [
			[V_LAST, BossAttack.SLAM],
		]);
		expect(bossPick(after)).toEqual(["idle", 0]);
	});

	it("stands idle in RECOVER once the release is over (also after the dead-player wait) and never flinches", () => {
		/** act1's PLAYER_DEAD_WAIT_TICKS (not exported): RECOVER for this long while the player is dead. */
		const DEAD_WAIT = 30;
		for (const k of ATTACKS) {
			for (const phase of [1, 2, 3]) {
				const wait = bossState({ aiState: BossState.RECOVER, aiTicks: DEAD_WAIT, phase }, [[V_LAST, k]]);
				expect([k, phase, ...bossPick(wait)]).toEqual([k, phase, "idle", 0]);
			}
		}
		const realHit = source({ ...ELITE_ANIMS, hit: anim(4, 12, false) });
		const hitRecovering = bossState({ aiState: BossState.RECOVER, aiTicks: 3, flashTicks: HIT_FLASH_TICKS });
		expect(bossPick(hitRecovering, 0, realHit)).toEqual(["idle", 0]);
		const hitDormant = bossState({ aiState: BossState.DORMANT, flashTicks: HIT_FLASH_TICKS });
		expect(bossPick(hitDormant, 0, realHit)).toEqual(["idle", 0]);
		expect(bossAct1SpriteInput(hitRecovering, 0).flinch).toBe(false);
	});

	it("falls back to `attack` for a missing named attack and from intro to taunt to idle for a missing roar", () => {
		const rel6 = math.round(BOSS_M.ringRelease * ELITE_ANIMS.attack.frames);
		const ringTg = bossState({ aiState: BossState.TELEGRAPH, attack: BossAttack.RING, aiTicks: 1 });
		expect(bossPick(ringTg, 0, BARE_BOSS)).toEqual(["attack", rel6 - 1]);
		const slamLanded = bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SLAM, aiTicks: 3 }, [[V_MARK, 4]]);
		expect(bossPick(slamLanded, 0, BARE_BOSS)).toEqual([
			"attack",
			segmentStart({ from: BOSS_M.slamLanding, to: 1 }, ELITE_ANIMS.attack.frames),
		]);
		const roar = bossState({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, phase: 1, aiTicks: 10 });
		expect(bossPick(roar, 0, BARE_BOSS)).toEqual(["idle", 0]);
		expect(bossPick({ ...roar, phase: 2 }, 0, BARE_BOSS)).toEqual(["idle", 0]);
		const introOnly = source({ ...BARE_BOSS.anims, intro: anim(4, 10, false) });
		expect(bossPick(roar, 0, introOnly)[0]).toBe("intro");
		expect(bossPick({ ...roar, phase: 2 }, 0, introOnly)).toEqual(["idle", 0]);
		const noAttack = source({ idle: ELITE_ANIMS.idle });
		expect(bossPick(ringTg, 0, noAttack)).toEqual(["idle", 0]);
	});

	it("fills its input from an ActorState; dead, no attack or roar", () => {
		const a = bossState({
			aiState: BossState.TELEGRAPH,
			attack: BossAttack.FAN,
			aiTicks: 20,
			flashTicks: 2,
			x: 0.05,
		});
		expect(bossAct1SpriteInput(a, 0.5)).toEqual({
			alive: true,
			deadTicks: 0,
			corpseTicks: BOSS_D.corpseTicks ?? CORPSE_TICKS,
			flashTicks: 2,
			attack: bossAct1Attack(a, 0.5),
			special: undefined,
			flinch: false,
			speed: tickSpeed(0, 0, 0.05, 0),
			refSpeed: BOSS_D.speed,
			alpha: 0.5,
		});
		const dead = bossState({
			alive: 0,
			deadTicks: 2,
			aiState: BossState.TRANSITION,
			attack: BossAttack.ROAR,
			aiTicks: 5,
		});
		expect([bossAct1SpriteInput(dead, 0).attack, bossAct1SpriteInput(dead, 0).special]).toEqual([
			undefined,
			undefined,
		]);
	});
});

describe("boss.act1 sprite timeline on a real fight (seed 1337)", () => {
	// The full sim (the bossAct1 spec's setup: MVP dungeon, boss-only encounter, a god-mode player standing in the arena,
	// DEBUG_BOSS presses to walk through the phases). Every tick is drawn at alpha 0 with the Elite set.
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, { boss: BOSS_ACT1_ID }),
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(1337, spawn.x, spawn.z, config);
	const boss = state.combat.actors[0];
	state.player.x = boss.x + 3;
	state.player.z = boss.z;
	/** One J press every this many ticks until phase 3, then the fight runs on in phase 3. */
	const PRESS_EVERY = 240;
	const TICKS = 4800;
	interface Tick {
		aiState: number;
		attack: number;
		phase: number;
		fired: boolean;
		anim: string;
		frame: number;
	}
	const ticks: Tick[] = [];
	for (let i = 0; i < TICKS && boss.alive !== 0; i++) {
		const press = boss.phase < 3 && i % PRESS_EVERY === PRESS_EVERY - 1;
		const spawned = state.combat.enemySpawned;
		step(state, { ...EMPTY_INPUT, buttons: press ? Button.DEBUG_BOSS : 0 }, config);
		state.player.hearts = state.player.heartsMax;
		const [animName, frame] = bossPick(boss);
		ticks.push({
			aiState: boss.aiState,
			attack: boss.attack,
			phase: boss.phase,
			fired: state.combat.enemySpawned > spawned, // only the boss fires bullets in this encounter
			anim: animName,
			frame,
		});
	}

	it("reaches every attack, both phase roars, a slam and a walk back", () => {
		const seen = new Set<number>();
		for (const t of ticks) if (t.aiState === BossState.TELEGRAPH) seen.add(t.attack);
		for (const k of ATTACKS) expect([k, seen.has(k)]).toEqual([k, true]);
		expect(ticks.some((t) => t.aiState === BossState.REPOSITION && t.anim === "move")).toBe(true);
		expect(ticks.some((t) => t.aiState === BossState.TRANSITION && t.phase === 3)).toBe(true);
	});

	it("roars intro then taunt, and never shows hit", () => {
		let roars = 0;
		for (let i = 0; i < ticks.size(); i++) {
			const t = ticks[i];
			expect(t.anim).never.toBe("hit");
			if (t.aiState !== BossState.TRANSITION) continue;
			expect(t.anim).toBe("taunt");
			if (i === 0 || ticks[i - 1].aiState !== BossState.TRANSITION) {
				roars++;
				expect([roars, t.phase]).toEqual([roars, roars]); // intro in phase 1, then the phase 2 and 3 roars
			}
		}
		expect(roars).toBe(3);
	});

	it("shows the last wind-up frame on each telegraph's last tick and a release frame on every bullet tick", () => {
		let checked = 0;
		for (let i = 1; i < ticks.size(); i++) {
			const t = ticks[i];
			const prev = ticks[i - 1];
			if (
				prev.aiState === BossState.TELEGRAPH &&
				t.aiState !== BossState.TELEGRAPH &&
				t.aiState !== BossState.TRANSITION
			) {
				expect([i, prev.anim, prev.frame]).toEqual([
					i,
					bossAct1AttackAnim(prev.attack),
					releaseFrame(prev.attack) - 1,
				]);
			}
			if (!t.fired) continue;
			checked++;
			// The attack that fired: ACTIVE's, or (on the tick the last burst enters RECOVER) the one just before.
			const k = t.aiState === BossState.ACTIVE ? t.attack : prev.attack;
			const name = bossAct1AttackAnim(k)!;
			if (k === BossAttack.SPIRAL) {
				const inLoop = t.anim === name && t.frame >= releaseFrame(k);
				// The last burst (t = SPIRAL_TICKS - SPIRAL_BURST_TICKS) ends the attack: RECOVER, idle.
				expect([i, inLoop || (t.aiState === BossState.RECOVER && t.anim === "idle")]).toEqual([i, true]);
			} else if (k === BossAttack.SLAM) {
				expect([i, t.anim, t.frame]).toEqual([i, name, LANDING]); // the shockwave on impact
			} else {
				expect([i, k, t.anim, t.frame]).toEqual([i, k, name, releaseFrame(k)]);
			}
		}
		expect(checked).toBeGreaterThan(50);
	});
});

describe("ACTOR_SPRITE_INPUTS", () => {
	it("has builders for the swarmer, the sniper, turret.sniper, the bruiser, boss.act1 and boss.demonlord (other archetypes: none)", () => {
		expect(ACTOR_SPRITE_INPUTS.size()).toBe(6);
		expect(ACTOR_SPRITE_INPUTS.get(SWARMER.id)).toBe(swarmerSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(SNIPER.id)).toBe(sniperSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(TURRET_SNIPER.id)).toBe(turretSniperSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(BRUISER.id)).toBe(bruiserSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(BOSS_ACT1_ID)).toBe(bossAct1SpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(BOSS_DEMONLORD_ID)).toBe(demonlordSpriteInput);
	});

	it("still draws the bruiser and both bosses as placeholders until the pack has a sprite set for them", () => {
		// ActorRenderController takes the sprite path only with a builder AND pack.sprites(spriteId) (a `sprites` asset).
		const quiet = () => undefined;
		const ids = [BRUISER.data.spriteId, BOSS_ACT1_DATA.spriteId, DEMONLORD_DATA.spriteId];
		for (const packId of listThemePacks()) {
			const pack = loadThemePack(packId, { warn: quiet });
			for (const id of ids) {
				const isSet = THEME_PACKS[packId].assets[id]?.kind === "sprites";
				expect([packId, id, pack.sprites(id) !== undefined]).toEqual([packId, id, isSet]);
			}
		}
		const noIds = loadThemePack("vale", { packs: { vale: buildValeManifest({}) }, warn: quiet });
		const placeholder = loadThemePack("placeholder", { warn: quiet });
		for (const id of ids) {
			expect([id, noIds.sprites(id), placeholder.sprites(id)]).toEqual([id, undefined, undefined]);
			expect(placeholder.placeholder(id).shape).toBe(noIds.placeholder(id).shape);
		}
	});

	it("plays a boss set's named attacks and roar against the set's real animation list", () => {
		const quiet = () => undefined;
		// The vale pack's uploaded swarmer set (asset IDs only live in shared/theme), re-labelled as a boss set with an
		// `attack.2` and a `taunt` and nothing else optional.
		const base = THEME_PACKS.vale.assets["enemy.swarmer"] as unknown as Record<string, unknown>;
		expect(base.kind).toBe("sprites");
		const baseAnims = base.animations as Record<string, unknown>;
		const set = { ...base, animations: { ...baseAnims, "attack.2": baseAnims.attack, taunt: baseAnims.death } };
		const manifest = {
			...PLACEHOLDER_MANIFEST,
			id: "test",
			assets: { ...PLACEHOLDER_MANIFEST.assets, [BOSS_ACT1_ID]: set },
		} as unknown as ThemeManifest;
		const pack = loadThemePack("test", { packs: { test: manifest }, warn: quiet });
		expect(pack.problems).toEqual([]);
		const sprites = pack.sprites(BOSS_ACT1_ID)!;
		expect(sprites).never.toBe(undefined);
		const choose = (over: Partial<ActorState>) => chooseActorAnim(bossAct1SpriteInput(bossState(over), 0), sprites);
		const ring = BOSS_TELEGRAPH_TICKS[BossAttack.RING];
		expect(choose({ aiState: BossState.TELEGRAPH, attack: BossAttack.RING, aiTicks: ring }).anim).toBe("attack.2");
		// No attack.3 in this set: the spiral falls back to attack; no intro: the intro roar plays taunt.
		const spiral = BOSS_TELEGRAPH_TICKS[BossAttack.SPIRAL];
		expect(choose({ aiState: BossState.TELEGRAPH, attack: BossAttack.SPIRAL, aiTicks: spiral }).anim).toBe(
			"attack",
		);
		expect(choose({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, aiTicks: 5 }).anim).toBe("taunt");
	});

	it("gives turret.sniper the sniper's sprite set (decision D3)", () => {
		expect(TURRET_SNIPER.data.spriteId).toBe(SNIPER.data.spriteId);
	});
});

// ---------------------------------------------------------------------------------------------
// The Demon Lord (docs/BOSS_DEMONLORD.md D6)

/** The boss.demonlord set's animations (art/atlases.json D1): the required five plus the optional three. */
const DEMON_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(8, 8, true),
	move: anim(8, 10, true),
	attack: anim(8, 12, false),
	"attack.2": anim(8, 12, false),
	intro: anim(8, 8, false),
	taunt: anim(8, 10, false),
	death: anim(8, 10, false),
	hit: anim(1, 1, false),
};
const DEMON = source(DEMON_ANIMS);
/** The set before the optional sheets are uploaded (the vale pack leaves them out until then). */
const DEMON_REQUIRED = source({
	idle: DEMON_ANIMS.idle,
	move: DEMON_ANIMS.move,
	attack: DEMON_ANIMS.attack,
	death: DEMON_ANIMS.death,
	hit: DEMON_ANIMS.hit,
});
const DA = DemonlordAttack;
const DS = DemonlordState;

/** A live Demon Lord standing still in `aiState` / `attack` (everything else neutral). */
function demon(aiState: number, attack: number, aiTicks: number, phase = 1, mark = 0): ActorState {
	const v = table.create<number>(ACTOR_SCRATCH_SLOTS, 0);
	v[DEMONLORD_V_MARK] = mark;
	return {
		id: 9,
		kind: 8,
		spawnTick: -1,
		x: 4,
		z: 5,
		prevX: 4,
		prevZ: 5,
		faceX: 0,
		faceZ: 1,
		hp: DEMONLORD_DATA.hp,
		hpMax: DEMONLORD_DATA.hp,
		radius: DEMONLORD_DATA.radius,
		alive: 1,
		deadTicks: 0,
		aiState,
		aiTicks,
		attack,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 3,
		phase,
		capBucket: -1,
		capWindow: table.create(DAMAGE_CAP_BUCKETS, 0),
		v,
	};
}

function demonChoice(a: ActorState, set: SpriteAnimSource = DEMON, alpha = 0) {
	return chooseActorAnim(demonlordSpriteInput(a, alpha), set);
}

describe("chooseActorAnim (Demon Lord)", () => {
	it("follows death > special > attack > hit > move > idle", () => {
		const special = { anim: "taunt", elapsed: 9, total: 90 };
		const attack = { elapsed: 10, total: 40, anim: "attack.2" };
		const all = actorInput({ alive: false, deadTicks: 15, special, attack, flashTicks: 3, speed: 4.2 });
		expect(chooseActorAnim({ ...all, deathTicks: 60 }, DEMON)).toEqual({ anim: "death", progress: 0.25, rate: 1 });
		expect(chooseActorAnim({ ...all, alive: true }, DEMON)).toEqual({ anim: "taunt", progress: 0.1, rate: 1 });
		expect(chooseActorAnim({ ...all, alive: true, special: undefined }, DEMON)).toEqual({
			anim: "attack.2",
			progress: 0.25,
			rate: 1,
		});
		expect(
			chooseActorAnim({ ...all, alive: true, special: undefined, attack: undefined, flashTicks: 0 }, DEMON).anim,
		).toBe("move");
	});

	it("falls back: a named attack the set lacks plays `attack`, a special it lacks plays what plays without it", () => {
		const attack = { elapsed: 10, total: 40, anim: "attack.2" };
		expect(chooseActorAnim(actorInput({ attack }), DEMON_REQUIRED)).toEqual({
			anim: "attack",
			progress: 0.25,
			rate: 1,
		});
		const special = { anim: "intro", elapsed: 1, total: 2 };
		expect(chooseActorAnim(actorInput({ special }), DEMON_REQUIRED)).toEqual({ anim: "idle", rate: 1 });
		expect(chooseActorAnim(actorInput({ special, attack }), DEMON_REQUIRED).anim).toBe("attack");
		// His specials name no fallback (Mother Bramble's intro falls back to taunt): with taunt but no intro, his
		// intro roar and his summon stand idle, while his phase taunt plays.
		const tauntOnly = source({
			idle: DEMON_ANIMS.idle,
			move: DEMON_ANIMS.move,
			attack: DEMON_ANIMS.attack,
			death: DEMON_ANIMS.death,
			hit: DEMON_ANIMS.hit,
			taunt: DEMON_ANIMS.taunt,
		});
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, 10, 1), tauntOnly)).toEqual({ anim: "idle", rate: 1 });
		expect(demonChoice(demon(DS.ACTIVE, DA.SUMMON, 10, 3), tauntOnly)).toEqual({ anim: "idle", rate: 1 });
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, 10, 2), tauntOnly).anim).toBe("taunt");
		// no attack animation at all: past the attack to idle
		expect(chooseActorAnim(actorInput({ attack }), source({ idle: DEMON_ANIMS.idle }))).toEqual({
			anim: "idle",
			rate: 1,
		});
	});

	it("DORMANT and RECOVER stand idle; CHASE and REPOSITION walk, the loop scaled by his chase speed", () => {
		expect(demonChoice(demon(DS.DORMANT, DA.NONE, 0))).toEqual({ anim: "idle", rate: 1 });
		expect(demonChoice(demon(DS.RECOVER, DA.NONE, 20, 2))).toEqual({ anim: "idle", rate: 1 });
		expect(SPRITE_VIEW.demonlordMoveRefSpeed).toBe(DEMONLORD_DATA.chaseSpeed);
		const chase = demon(DS.CHASE, DA.CLEAVE, 30);
		chase.prevX = chase.x - DEMONLORD_DATA.chaseSpeed / SIM_HZ;
		const walking = demonChoice(chase);
		expect(walking.anim).toBe("move");
		expect(walking.rate).toBeCloseTo(1, 9);
		const home = demon(DS.REPOSITION, DA.NONE, 30);
		home.prevZ = home.z - DEMONLORD_DATA.speed / SIM_HZ;
		const walk = demonChoice(home);
		expect(walk.anim).toBe("move");
		expect(walk.rate).toBeCloseTo(DEMONLORD_DATA.speed / DEMONLORD_DATA.chaseSpeed, 9);
	});

	it("TRANSITION: the intro in phase 1 over introTicks, the taunt in phases 2-3 over transitionTicks", () => {
		const intro = DEMONLORD_DATA.introTicks;
		const taunt = DEMONLORD_DATA.transitionTicks;
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, intro, 1))).toEqual({ anim: "intro", progress: 0, rate: 1 });
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, intro / 2, 1))).toEqual({
			anim: "intro",
			progress: 0.5,
			rate: 1,
		});
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, 0, 2))).toEqual({ anim: "taunt", progress: 1, rate: 1 });
		expect(demonlordSpecial(DS.TRANSITION, DA.ROAR, 3, taunt / 3, 0.5)).toEqual({
			anim: "taunt",
			elapsed: taunt - taunt / 3 + 0.5,
			total: taunt,
		});
		// without the optional sheets: idle (he stands immune)
		expect(demonChoice(demon(DS.TRANSITION, DA.ROAR, intro, 1), DEMON_REQUIRED)).toEqual({ anim: "idle", rate: 1 });
	});

	it("CLEAVE / DOUBLE_CLEAVE: `attack` stretched over the telegraph + the whole active span, continuous", () => {
		for (const [attack, active] of [
			[DA.CLEAVE, CLEAVE_HOLD_TICKS],
			[DA.DOUBLE_CLEAVE, DOUBLE_CLEAVE_DELAY_TICKS + CLEAVE_HOLD_TICKS],
		]) {
			const tele = DEMONLORD_TELEGRAPH_TICKS[attack];
			const total = tele + active;
			expect(demonlordAttack(AiState.TELEGRAPH, attack, tele, 0, 0)).toEqual({
				elapsed: 0,
				total,
				anim: "attack",
			});
			// the last TELEGRAPH tick + alpha 1 meets ACTIVE tick 0 + alpha 0
			expect(demonlordAttack(AiState.TELEGRAPH, attack, 1, 0, 1)!.elapsed).toBe(tele);
			expect(demonlordAttack(DS.ACTIVE, attack, 0, 0, 0)!.elapsed).toBe(tele);
			// the last ACTIVE tick (the attack ends on tick `active`) + alpha 1 ends the swing
			expect(demonlordAttack(DS.ACTIVE, attack, active - 1, 0, 1)!.elapsed).toBe(total);
			expect(demonChoice(demon(DS.ACTIVE, attack, 0, 3))).toEqual({
				anim: "attack",
				progress: tele / total,
				rate: 1,
			});
		}
		// CHASE before the cleave: no attack yet (directions are not locked; he walks)
		expect(demonlordAttack(DS.CHASE, DA.CLEAVE, 20, 0, 0)).toBe(undefined);
	});

	it("HELLFIRE: `attack.2` over the telegraph + hold (`attack` without the sheet)", () => {
		const tele = DEMONLORD_TELEGRAPH_TICKS[DA.HELLFIRE];
		const total = tele + HELLFIRE_HOLD_TICKS;
		expect(demonChoice(demon(AiState.TELEGRAPH, DA.HELLFIRE, tele / 2))).toEqual({
			anim: "attack.2",
			progress: tele / 2 / total,
			rate: 1,
		});
		expect(demonChoice(demon(AiState.TELEGRAPH, DA.HELLFIRE, tele / 2), DEMON_REQUIRED).anim).toBe("attack");
	});

	it("CHARGE: idle through the wind-up, move while charging, `attack.2` from the impact over the impact hold", () => {
		expect(demonChoice(demon(AiState.TELEGRAPH, DA.CHARGE, 20, 2))).toEqual({ anim: "idle", rate: 1 });
		const run = demon(DS.ACTIVE, DA.CHARGE, 6, 2, 0);
		run.prevX = run.x - CHARGE_SPEED / SIM_HZ;
		expect(demonChoice(run)).toEqual({ anim: "move", rate: SPRITE_VIEW.loopRateMax });
		// impact on ACTIVE tick 9: v[MARK] = 10; the attack ends CHARGE_IMPACT_HOLD_TICKS later
		const mark = 10;
		expect(demonlordAttack(DS.ACTIVE, DA.CHARGE, 9, mark, 0)).toEqual({
			elapsed: 0,
			total: CHARGE_IMPACT_HOLD_TICKS,
			anim: "attack.2",
		});
		expect(demonlordAttack(DS.ACTIVE, DA.CHARGE, 9 + CHARGE_IMPACT_HOLD_TICKS - 1, mark, 1)!.elapsed).toBe(
			CHARGE_IMPACT_HOLD_TICKS,
		);
		const impact = demon(DS.ACTIVE, DA.CHARGE, 9, 2, mark);
		impact.prevX = impact.x - 0.2; // the last step of the run: the swing still wins
		expect(demonChoice(impact).anim).toBe("attack.2");
	});

	it("SUMMON: `intro` (a special) over the telegraph + hold; idle without the sheet, never an attack swing", () => {
		const tele = DEMONLORD_TELEGRAPH_TICKS[DA.SUMMON];
		const total = tele + SUMMON_HOLD_TICKS;
		expect(demonChoice(demon(DS.ACTIVE, DA.SUMMON, 10, 3))).toEqual({
			anim: "intro",
			progress: (tele + 10) / total,
			rate: 1,
		});
		expect(demonlordAttack(DS.ACTIVE, DA.SUMMON, 10, 0, 0)).toBe(undefined);
		expect(demonChoice(demon(DS.ACTIVE, DA.SUMMON, 10, 3), DEMON_REQUIRED)).toEqual({ anim: "idle", rate: 1 });
	});

	it("death: stretched over bossDeathCorpseFraction of his corpse time, then held", () => {
		const a = demon(DS.RECOVER, DA.NONE, 0, 3);
		a.alive = 0;
		const span = (DEMONLORD_DATA.corpseTicks ?? CORPSE_TICKS) * SPRITE_VIEW.bossDeathCorpseFraction;
		a.deadTicks = span / 2;
		expect(demonChoice(a)).toEqual({ anim: "death", progress: 0.5, rate: 1 });
		a.deadTicks = span * 1.5;
		expect(demonChoice(a).progress).toBe(1.5); // stretchedFrame holds the last frame
		expect(demonlordSpriteInput(a, 0).attack).toBe(undefined);
		expect(demonlordSpriteInput(a, 0).special).toBe(undefined);
	});

	it("is drawn at least bossMinDrawPx wide (a narrower layout grows; the Demon Lord's own cell already is)", () => {
		const big = { frameW: 98, frameH: 78, pivot: { x: 39, y: 56 }, pixelsPerTile: 10.5 };
		expect(bossSpriteLayout(big, ACTOR_VIEW.bossMinDrawPx)).toBe(big);
		const small = { frameW: 20, frameH: 20, pivot: { x: 10, y: 18 }, pixelsPerTile: 16 };
		const grown = bossSpriteLayout(small, ACTOR_VIEW.bossMinDrawPx);
		expect((grown.frameW / grown.pixelsPerTile) * PIXELS_PER_TILE).toBeCloseTo(ACTOR_VIEW.bossMinDrawPx, 12);
		expect([grown.frameW, grown.frameH, grown.pivot]).toEqual([small.frameW, small.frameH, small.pivot]);
		// Both bosses' built sets already are (the Demon Lord at 10.5 px / tile, Mother Bramble at bodyTiles 2.5): the
		// rule leaves them at their own density, so per-sheet cells (sheetSpriteLayout) start from the set itself.
		for (const id of ["boss.demonlord", "boss.act1"]) {
			const built = VALE_SPRITE_LAYOUTS[id];
			expect([id, bossSpriteLayout(built, ACTOR_VIEW.bossMinDrawPx) === built]).toEqual([id, true]);
		}
	});

	it("corpse: the Demon Lord holds until bossCorpseFadeFrom, then fades; Mother Bramble fades over the whole corpse", () => {
		const a = demon(DS.RECOVER, DA.NONE, 0, 3);
		a.alive = 0;
		const corpse = DEMONLORD_DATA.corpseTicks ?? CORPSE_TICKS;
		expect(demonlordSpriteInput(a, 0).corpseFadeFrom).toBe(SPRITE_VIEW.bossCorpseFadeFrom);
		const from = SPRITE_VIEW.bossCorpseFadeFrom;
		expect(corpseTransparency(0, corpse * from, corpse, demonlordSpriteInput(a, 0).corpseFadeFrom)).toBe(0);
		expect(corpseTransparency(0, corpse, corpse, demonlordSpriteInput(a, 0).corpseFadeFrom)).toBe(1);
		const bramble = bossAct1SpriteInput(bossState({ alive: 0, deadTicks: 10 }), 0);
		expect([bramble.corpseFadeFrom, bramble.deathTicks]).toEqual([undefined, undefined]);
		const brambleCorpse = BOSS_ACT1_DATA.corpseTicks ?? CORPSE_TICKS;
		expect(corpseTransparency(0, brambleCorpse / 2, brambleCorpse, bramble.corpseFadeFrom)).toBe(0.5);
	});
});

// ---------------------------------------------------------------------------------------------
// The marks on the built 2D Demons sets (docs/DEMON_ART.md DA3, docs/BRAMBLE_ART.md BR3)

describe("SPRITE_ANIM_MARKS on the built enemy.bruiser and boss.act1 sets (art/atlases.json via layout.ts)", () => {
	// The kept-frame indices below are the art measurement (DEMON_ART DA1, BRAMBLE_ART BR1), not the table: this pins
	// that the table, read through segmentStart / segmentLength, lands on them with the frame counts art:build wrote.
	const beast = VALE_SPRITE_LAYOUTS["enemy.bruiser"];
	const elite = VALE_SPRITE_LAYOUTS["boss.act1"];
	/** [first frame, frame count] of `[from, to)` in an n-frame animation. */
	const part = (from: number, to: number, n: number) => [
		segmentStart({ from, to }, n),
		segmentLength({ from, to }, n),
	];

	it("bruiser Attack 4: leap 0-5 over the telegraph, impact 6 on the slam tick, follow-through 7 held", () => {
		const M = SPRITE_ANIM_MARKS.bruiser;
		const n = beast.animations.attack.frames;
		expect(n).toBe(8);
		expect(part(0, M.impact, n)).toEqual([0, 6]);
		expect(part(M.impact, M.followThrough, n)).toEqual([6, 1]);
		expect(part(M.followThrough, 1, n)).toEqual([7, 1]);
		// drawn through the renderer with the built set's animation list
		const set = source(beast.animations);
		const pick = (aiState: number, aiTicks: number, alpha = 0) =>
			spriteFrame(
				set,
				chooseActorAnim(bruiserSpriteInput(actorState({ aiState, aiTicks }), alpha), set),
				undefined,
				0,
			).frame;
		const d = BRUISER.data;
		expect(pick(AiState.TELEGRAPH, d.telegraphTicks)).toBe(0);
		expect(pick(AiState.TELEGRAPH, 1, 0.99)).toBe(5);
		expect(pick(BRUISER_RECOVER, d.recoverTicks)).toBe(6);
		expect(pick(BRUISER_RECOVER, d.recoverTicks - M.impactTicks)).toBe(7);
		expect(pick(BRUISER_RECOVER, 1, 0.99)).toBe(7);
	});

	it("Mother Bramble: sweep / strike release 3 of 6, spin telegraph 0-1 and loop 2-5, leap 0-2 / 3-5 / landing 6-7", () => {
		const M = SPRITE_ANIM_MARKS.bossAct1;
		const a = elite.animations;
		expect([a.attack.frames, a["attack.2"].frames, a["attack.3"].frames, a["attack.4"].frames]).toEqual([
			6, 6, 6, 8,
		]);
		expect(part(0, M.fanRelease, a.attack.frames)).toEqual([0, 3]);
		expect(part(M.fanRelease, 1, a.attack.frames)).toEqual([3, 3]);
		expect(part(M.ringRelease, 1, a["attack.2"].frames)).toEqual([3, 3]);
		expect(part(0, M.spiralRelease, a["attack.3"].frames)).toEqual([0, 2]);
		expect(part(M.spiralRelease, 1, a["attack.3"].frames)).toEqual([2, 4]);
		expect(part(0, M.slamTakeoff, a["attack.4"].frames)).toEqual([0, 3]);
		expect(part(M.slamTakeoff, M.slamLanding, a["attack.4"].frames)).toEqual([3, 3]);
		expect(part(M.slamLanding, 1, a["attack.4"].frames)).toEqual([6, 2]);
		// The spiral channel loops 2-5 with the built set's fps: one frame per burst (SPIRAL_BURST_TICKS).
		const set = source(a);
		const spin = (t: number) =>
			bossPick(bossState({ aiState: BossState.ACTIVE, attack: BossAttack.SPIRAL, aiTicks: t, phase: 2 }), 0, set);
		const ticksPerFrame = SIM_HZ / a["attack.3"].fps;
		expect(ticksPerFrame).toBe(SPIRAL_BURST_TICKS);
		const seen = new Array<number>();
		for (let k = 0; k < 5; k++) seen.push(spin(k * ticksPerFrame)[1]);
		expect(seen).toEqual([2, 3, 4, 5, 2]);
	});

	it("Mother Bramble's set has every animation the renderer asks for: the roars play taunt, hit is idle's cell", () => {
		const a = elite.animations;
		for (const name of ["idle", "move", "attack", "attack.2", "attack.3", "attack.4", "taunt", "hit", "death"]) {
			expect([name, a[name] !== undefined]).toEqual([name, true]);
		}
		expect(a.intro).toBe(undefined);
		expect([a.hit.sheet, a.hit.start, a.hit.frames]).toEqual([a.idle.sheet, a.idle.start, 1]);
		const set = source(a);
		const roar = bossState({ aiState: BossState.TRANSITION, attack: BossAttack.ROAR, phase: 1, aiTicks: 1 });
		expect(bossPick(roar, 0, set)).toEqual(["taunt", a.taunt.frames - 1]);
	});
});
