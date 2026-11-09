// The Archer's sprite (docs/ARCHER.md AR12): the bow's state -> attack.1 (stream) / attack.2 (draw, release) on the
// class.ranger visual; the Knight's choices untouched. Pure helpers, a real sim run, and the built set (layout.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ATTACK_TICKS_BOON_PERCENT,
	BOW_DATA,
	BOW_V_CHARGE,
	BOW_V_HEAVY_TICK,
	BOW_V_SHOT,
	Button,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	NO_WEAPON,
	PLAYER_SPEED,
	ROLL_TICKS,
	SWORD_V_LAST,
	WEAPON_SCRATCH_SLOTS,
	attackTicks,
	createSimState,
	newPlayerState,
	step,
	weaponIndex,
	type InputFrame,
	type SimConfig,
	type SimState,
	type WeaponsState,
} from "shared/sim";
import type { SpriteAnimationDef } from "shared/theme";
import { VALE_SPRITE_LAYOUTS } from "shared/theme/packs/vale";
import {
	ACTOR_VIEW,
	ARCHER_SPRITE,
	BOW_TIMING,
	SPRITE_ANIM_MARKS,
	archerSpriteInput,
	bowShot,
	bowShotOf,
	bowTimingOf,
	choosePlayerAnim,
	playerSpriteInput,
	playerSpriteInputFor,
	segmentLength,
	segmentStart,
	spriteFrame,
	swordTimingOf,
	type BowShot,
	type PlayerSpriteInput,
	type SpriteAnimSource,
} from "shared/view";

function anim(frames: number, fps: number, loop: boolean): SpriteAnimationDef {
	return { sheet: 0, start: 0, frames, fps, loop };
}

function source(anims: Readonly<Record<string, SpriteAnimationDef>>): SpriteAnimSource {
	return {
		animation(name: string) {
			return anims[name];
		},
	};
}

const ARCHER_ANIMS: Record<string, SpriteAnimationDef> = {
	idle: anim(8, 7, true),
	run: anim(8, 12, true),
	roll: anim(8, 14, false),
	hit: anim(8, 14, false),
	death: anim(8, 10, false),
	"attack.1": anim(8, 20, false),
	"attack.2": anim(8, 14, false),
};
const ARCHER = source(ARCHER_ANIMS);
const M = SPRITE_ANIM_MARKS.archer;
const DRAW = { from: 0, to: M.release };
const RELEASE = { from: M.release, to: 1 };
const CYCLE_0 = { from: 0, to: M.streamCycle };
const CYCLE_1 = { from: M.streamCycle, to: 1 };

function input(over: Partial<PlayerSpriteInput>): PlayerSpriteInput {
	return { dead: false, rollTicks: 0, hurtTicks: 0, swing: undefined, speed: 0, alpha: 0, ...over };
}

const BOW = 4;
const SWORD = 9;

function weapons(weapon: number): WeaponsState {
	return {
		activeSet: 0,
		prevButtons: 0,
		emitterId: 0,
		sets: [{ weapon, cooldown: 0, v: table.create(WEAPON_SCRATCH_SLOTS, 0) }],
		swingTick: -1,
		swingX: 0,
		swingZ: 0,
		swingDirX: 1,
		swingDirZ: 0,
		swingRadius: 1,
		swingHalfCos: 0.5,
	};
}

describe("ARCHER_SPRITE and BOW_TIMING", () => {
	it("is the class.ranger visual, never the Knight's (the default player visual)", () => {
		expect(ARCHER_SPRITE.visualId).toBe("class.ranger");
		expect(ACTOR_VIEW.playerVisualId).toBe("class.vanguard");
		expect([ARCHER_SPRITE.streamAnim, ARCHER_SPRITE.chargeAnim]).toEqual(["attack.1", "attack.2"]);
	});

	it("reads the bow's timings from BOW_DATA, through Swift Strikes", () => {
		expect(BOW_TIMING).toEqual({
			streamTicks: BOW_DATA.cooldownTicks,
			chargeTicks: BOW_DATA.chargeTicks,
			recoverTicks: BOW_DATA.heavyRecoverTicks,
		});
		expect(bowTimingOf({ run: undefined } as unknown as SimState, 0)).toBe(BOW_TIMING);
		const swift = {
			run: { players: [{ mods: { attackTicksPercent: ATTACK_TICKS_BOON_PERCENT, ballistaChargePercent: 100 } }] },
		} as unknown as SimState;
		const t = bowTimingOf(swift, 0);
		expect(t.streamTicks).toBe(attackTicks(swift, 0, BOW_DATA.cooldownTicks));
		expect(t.streamTicks).toBeLessThan(BOW_DATA.cooldownTicks);
		expect([t.chargeTicks, t.recoverTicks]).toEqual([BOW_DATA.chargeTicks, BOW_DATA.heavyRecoverTicks]);
	});
});

describe("bowShot", () => {
	const T = BOW_TIMING;

	it("is undefined while the bow is idle (or a stale heavy arrow is past its wait)", () => {
		expect(bowShot(100, 0, 0, 0, 0, 0)).toBe(undefined);
		expect(bowShot(100, 0, 0, 100 - T.recoverTicks, 0, 0)).toBe(undefined);
	});

	it("draws over the charge, interpolated, and holds the anchor once fully charged", () => {
		expect(bowShot(100, 0, 1, 0, 0, 0)).toEqual({ kind: "draw", progress: 1 / T.chargeTicks, segment: DRAW });
		expect(bowShot(100, 0.5, 10, 0, 0, 0)?.progress).toBe(10.5 / T.chargeTicks);
		expect(bowShot(100, 0.9, T.chargeTicks, 0, 0, 0)?.progress).toBe(1);
		expect(bowShot(100, 0.9, T.chargeTicks - 1, 0, 0, 0)?.progress).toBe((T.chargeTicks - 0.1) / T.chargeTicks);
		// a fresh draw beats the wait of an earlier heavy arrow and a running stream cooldown
		expect(bowShot(100, 0, 3, 99, 5, 1)?.kind).toBe("draw");
	});

	it("releases over the stream's wait from the tick after the heavy arrow", () => {
		expect(bowShot(101, 0, 0, 101, T.recoverTicks, 2)).toEqual({ kind: "release", progress: 0, segment: RELEASE });
		expect(bowShot(110, 0.5, 0, 101, 9, 2)?.progress).toBe(9.5 / T.recoverTicks);
		expect(bowShot(101 + T.recoverTicks - 1, 0.99, 0, 101, 1, 2)?.kind).toBe("release");
		expect(bowShot(101 + T.recoverTicks, 0, 0, 101, 0, 2)).toBe(undefined);
	});

	it("plays one draw-and-loose cycle per stream arrow over its cooldown, alternating by the pattern step", () => {
		expect(bowShot(50, 0, 0, 0, T.streamTicks, 1)).toEqual({ kind: "stream", progress: 0, segment: CYCLE_0 });
		expect(bowShot(50, 0.5, 0, 0, T.streamTicks - 3, 2)).toEqual({
			kind: "stream",
			progress: 3.5 / T.streamTicks,
			segment: CYCLE_1,
		});
		expect(bowShot(50, 0, 0, 0, 1, 3)?.segment).toEqual(CYCLE_0);
		expect(bowShot(50, 0, 0, 0, 1, 0)?.segment).toEqual(CYCLE_1);
		// Swift Strikes' shorter cooldown stretches the cycle over it
		const swift = { ...T, streamTicks: 10 };
		expect(bowShot(50, 0, 0, 0, 10, 1, swift)?.progress).toBe(0);
		expect(bowShot(50, 0, 0, 0, 5, 1, swift)?.progress).toBe(0.5);
	});
});

describe("bowShotOf and the sprite inputs", () => {
	it("reads only the ACTIVE set's bow", () => {
		const w = weapons(BOW);
		w.sets[0].v[BOW_V_CHARGE] = 6;
		expect(bowShotOf(10, 0, w, BOW)?.kind).toBe("draw");
		expect(bowShotOf(10, 0, w, SWORD)).toBe(undefined);
		expect(bowShotOf(10, 0, w, NO_WEAPON)).toBe(undefined);
		w.sets.push({ weapon: SWORD, cooldown: 0, v: table.create(WEAPON_SCRATCH_SLOTS, 0) });
		w.activeSet = 1; // swapped to the sword: the bow's state is not drawn
		expect(bowShotOf(10, 0, w, BOW)).toBe(undefined);
		w.activeSet = 0;
		w.sets[0].v[BOW_V_CHARGE] = 0;
		w.sets[0].v[BOW_V_HEAVY_TICK] = 8;
		w.sets[0].cooldown = 16;
		expect(bowShotOf(10, 0.25, w, BOW)).toEqual(bowShot(10, 0.25, 0, 8, 16, 0));
		w.sets[0].v[BOW_V_HEAVY_TICK] = 0;
		w.sets[0].cooldown = 4;
		w.sets[0].v[BOW_V_SHOT] = 3;
		expect(bowShotOf(10, 0, w, BOW)).toEqual(bowShot(10, 0, 0, 0, 4, 3));
	});

	it("archerSpriteInput carries the bow and no swing; the Knight's input never carries the bow", () => {
		const w = weapons(BOW);
		w.sets[0].cooldown = BOW_DATA.cooldownTicks;
		w.sets[0].v[BOW_V_SHOT] = 1;
		const p = newPlayerState(0, 0);
		p.x = 0.1;
		p.hurtTicks = 3;
		expect(archerSpriteInput(p, w, 20, 0.5, BOW)).toEqual({
			dead: false,
			rollTicks: 0,
			hurtTicks: 3,
			swing: undefined,
			bow: bowShot(20, 0.5, 0, 0, BOW_DATA.cooldownTicks, 1),
			speed: playerSpriteInput(p, w, 20, 0.5, SWORD).speed,
			alpha: 0.5,
		});
		expect(playerSpriteInput(p, w, 20, 0.5, SWORD).bow).toBe(undefined);
	});
});

describe("choosePlayerAnim with the bow", () => {
	const stream: BowShot = { kind: "stream", progress: 0.5, segment: CYCLE_1 };
	const draw: BowShot = { kind: "draw", progress: 0.25, segment: DRAW };
	const release: BowShot = { kind: "release", progress: 0.5, segment: RELEASE };

	it("plays the stream on attack.1 and the charge on attack.2, each in its segment", () => {
		expect(choosePlayerAnim(input({ bow: stream }), ARCHER)).toEqual({
			anim: "attack.1",
			progress: 0.5,
			rate: 1,
			segment: CYCLE_1,
		});
		expect(choosePlayerAnim(input({ bow: draw }), ARCHER)).toEqual({
			anim: "attack.2",
			progress: 0.25,
			rate: 1,
			segment: DRAW,
		});
		expect(choosePlayerAnim(input({ bow: release }), ARCHER).segment).toEqual(RELEASE);
	});

	it("death and the roll beat the bow; the bow beats the hit flinch", () => {
		expect(choosePlayerAnim(input({ bow: draw, dead: true }), ARCHER).anim).toBe("death");
		expect(choosePlayerAnim(input({ bow: draw, rollTicks: ROLL_TICKS }), ARCHER).anim).toBe("roll");
		expect(choosePlayerAnim(input({ bow: draw, hurtTicks: 40 }), ARCHER).anim).toBe("attack.2");
	});

	it("the stream yields to run at run speed; the draw and the release never do", () => {
		const moving = { speed: PLAYER_SPEED };
		expect(ARCHER_SPRITE.streamYieldsToRun).toBe(true);
		expect(choosePlayerAnim(input({ bow: stream, ...moving }), ARCHER).anim).toBe("run");
		expect(choosePlayerAnim(input({ bow: stream, speed: 0.5 }), ARCHER).anim).toBe("attack.1");
		expect(choosePlayerAnim(input({ bow: draw, speed: PLAYER_SPEED / 2 }), ARCHER).anim).toBe("attack.2");
		expect(choosePlayerAnim(input({ bow: release, ...moving }), ARCHER).anim).toBe("attack.2");
		// without a run animation the stream keeps its pose
		const noRun = source({ idle: ARCHER_ANIMS.idle, "attack.1": ARCHER_ANIMS["attack.1"] });
		expect(choosePlayerAnim(input({ bow: stream, ...moving }), noRun).anim).toBe("attack.1");
	});

	it("falls through to what plays without it when the set lacks the animation (the placeholder, the Knight's set)", () => {
		const knight = source({ idle: ARCHER_ANIMS.idle, run: ARCHER_ANIMS.run, hit: ARCHER_ANIMS.hit });
		expect(choosePlayerAnim(input({ bow: draw }), knight)).toEqual({ anim: "idle", rate: 1 });
		expect(choosePlayerAnim(input({ bow: draw, hurtTicks: 40 }), knight).anim).toBe("hit");
	});
});

/** One tick's bow shot (wrapped: a roblox-ts array cannot hold undefined). */
interface Logged {
	readonly shot: BowShot | undefined;
}

describe("playerSpriteInputFor (a real sim run, the bow alone)", () => {
	const config: SimConfig = { bounds: DEFAULT_BOUNDS, loadout: ["weapon.bow", undefined] };
	const bowIndex = weaponIndex("weapon.bow");
	const swordIndex = weaponIndex("weapon.sword");
	const press = (s: SimState, buttons: number, ticks: number, log: Array<Logged>) => {
		const frame: InputFrame = { ...EMPTY_INPUT, aimX: 100, buttons };
		for (let i = 0; i < ticks; i++) {
			step(s, frame, config);
			log.push({ shot: playerSpriteInputFor(ARCHER_SPRITE.visualId, s, 0, 0, swordIndex, bowIndex).bow });
		}
	};

	it("draws over the charge, holds the anchor, releases over the wait, then streams one cycle per arrow", () => {
		const s = createSimState(1, 0, 0, config);
		const log = new Array<Logged>();
		press(s, Button.ALT, BOW_DATA.chargeTicks + 10, log);
		for (let i = 0; i < BOW_DATA.chargeTicks; i++) expect(log[i].shot?.kind).toBe("draw");
		expect(log[BOW_DATA.chargeTicks - 1].shot?.progress).toBe(1);
		expect(log[BOW_DATA.chargeTicks + 9].shot?.progress).toBe(1); // held at full draw
		const released = log.size();
		press(s, 0, BOW_DATA.heavyRecoverTicks + 2, log);
		expect(log[released].shot).toEqual({ kind: "release", progress: 0, segment: RELEASE });
		for (let i = 0; i < BOW_DATA.heavyRecoverTicks; i++) expect(log[released + i].shot?.kind).toBe("release");
		expect(log[released + BOW_DATA.heavyRecoverTicks].shot).toBe(undefined);
		const streamed = log.size();
		press(s, Button.FIRE, 3 * BOW_DATA.cooldownTicks, log);
		const cycles = new Array<number>();
		for (let i = 0; i < 3 * BOW_DATA.cooldownTicks; i++) {
			const shot = log[streamed + i].shot!;
			expect(shot.kind).toBe("stream");
			expect(shot.progress).toBe((i % BOW_DATA.cooldownTicks) / BOW_DATA.cooldownTicks);
			if (i % BOW_DATA.cooldownTicks === 0) cycles.push(shot.segment.from);
		}
		expect(cycles).toEqual([0, M.streamCycle, 0]);
	});

	it("the Knight's visual is exactly playerSpriteInput with the sword, whatever the bow does", () => {
		const s = createSimState(1, 0, 0, config);
		const log = new Array<Logged>();
		press(s, Button.ALT, 5, log);
		const knight = playerSpriteInputFor(ACTOR_VIEW.playerVisualId, s, 0, 0.5, swordIndex, bowIndex);
		expect(knight).toEqual(
			playerSpriteInput(s.player, s.combat.weapons, s.tick, 0.5, swordIndex, swordTimingOf(s, 0)),
		);
		expect(knight.bow).toBe(undefined);
		expect(choosePlayerAnim(knight, ARCHER).anim).toBe("idle");
		// and the knight's sword swings are untouched by the Archer's mapping
		const w = weapons(SWORD);
		w.swingTick = 100;
		w.sets[0].v[SWORD_V_LAST] = 1;
		expect(choosePlayerAnim(playerSpriteInput(newPlayerState(0, 0), w, 101, 0, SWORD), ARCHER)).toEqual({
			anim: "attack.1",
			progress: 0,
			rate: 1,
		});
	});
});

describe("SPRITE_ANIM_MARKS.archer on the built class.ranger set (art/atlases.json via layout.ts)", () => {
	const ranger = VALE_SPRITE_LAYOUTS["class.ranger"];
	const part = (from: number, to: number, n: number) => [
		segmentStart({ from, to }, n),
		segmentLength({ from, to }, n),
	];

	it("has the Knight's five and the bow's two animations, 8 frames each, at the Knight's scale", () => {
		const a = ranger.animations;
		for (const name of ["idle", "run", "roll", "hit", "death", "attack.1", "attack.2"]) {
			expect([name, a[name]?.frames]).toEqual([name, 8]);
		}
		expect(ranger.pixelsPerTile).toBe(VALE_SPRITE_LAYOUTS["class.vanguard"].pixelsPerTile);
		expect(ranger.facings).toEqual(VALE_SPRITE_LAYOUTS["class.vanguard"].facings);
		for (const sh of ranger.sheets) expect(sh.outlineFile).toBe(sh.file.gsub("%.png$", "-outline.png")[0]);
	});

	it("attack.2: the draw 0-4 (anchor 4 held), the release 5-7; attack.1: cycles 0-3 and 4-7", () => {
		const n = ranger.animations["attack.2"].frames;
		expect(part(0, M.release, n)).toEqual([0, 5]);
		expect(part(M.release, 1, n)).toEqual([5, 3]);
		const k = ranger.animations["attack.1"].frames;
		expect(part(0, M.streamCycle, k)).toEqual([0, 4]);
		expect(part(M.streamCycle, 1, k)).toEqual([4, 4]);
		const set = source(ranger.animations);
		const frame = (bow: BowShot) => spriteFrame(set, choosePlayerAnim(input({ bow }), set), undefined, 0).frame;
		expect(frame(bowShot(10, 0, 1, 0, 0, 0)!)).toBe(0);
		expect(frame(bowShot(10, 0, BOW_DATA.chargeTicks, 0, 0, 0)!)).toBe(4);
		expect(frame(bowShot(10, 0, 0, 10, BOW_DATA.heavyRecoverTicks, 0)!)).toBe(5);
		expect(frame(bowShot(10, 0.99, 0, 10 - BOW_DATA.heavyRecoverTicks + 1, 1, 0)!)).toBe(7);
		expect(frame(bowShot(10, 0, 0, 0, BOW_DATA.cooldownTicks, 1)!)).toBe(0);
		expect(frame(bowShot(10, 0.99, 0, 0, 1, 2)!)).toBe(7);
	});
});
