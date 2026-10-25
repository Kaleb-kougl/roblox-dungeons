// 'weapon.bow' (E1.8, ported from src/sim/weapons/defs/bow.test.ts): stream cadence and pattern under FIRE, the ALT
// charge (timing, cancel, slow walk, no stream), the heavy arrow (damage, speed, size) and its pierce (each actor once,
// up to heavyPierce + 1, then consumed).
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import {
	BOW_DATA,
	BOW_V_CHARGE,
	BOW_WOBBLE_COS,
	BOW_WOBBLE_SIN,
	BulletPayload,
	Button,
	EMPTY_INPUT,
	PLAYER_MUZZLE_OFFSET,
	PLAYER_SPEED,
	SIM_DT,
	createSimState,
	step,
	weaponIndex,
	type ActorSpawn,
	type EncounterConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: 1000, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const ALT = frame({ buttons: Button.ALT });
const BOW: SimConfig = { loadout: ["weapon.bow", "weapon.sword"] };
const withBow = (spawns: ActorSpawn[]): SimConfig => ({ ...BOW, encounter: enc(spawns) });

interface Arrow {
	x: number;
	z: number;
	vx: number;
	vz: number;
	speed: number;
	damage: number;
	pierce: number;
	source: number;
	scale: number;
}

function arrows(s: SimState): Arrow[] {
	const out: Arrow[] = [];
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, pos, payload) => {
		const v = sim.velocityAt(i);
		out.push({
			x: pos.x,
			z: pos.z,
			vx: v.x,
			vz: v.z,
			speed: math.sqrt(v.x * v.x + v.z * v.z),
			damage: BulletPayload.get(payload, "damage"),
			pierce: BulletPayload.get(payload, "pierce"),
			source: BulletPayload.get(payload, "source"),
			scale: sim.scaleAt(i),
		});
	});
	return out;
}

/** Holds ALT for `ticks` ticks then releases (one idle tick). */
function charge(s: SimState, ticks: number, config: SimConfig = BOW): void {
	for (let t = 0; t < ticks; t++) step(s, ALT, config);
	step(s, IDLE, config);
}

describe("bow: FIRE stream", () => {
	it("fires one fast arrow on the press tick, then every streamTicks (5 / s) while held", () => {
		expect(BOW_DATA.streamTicks).toBe(12);
		expect(BOW_DATA.cooldownTicks).toBe(BOW_DATA.streamTicks);
		const s = createSimState(1, 0, 0, BOW);
		const shots: number[] = [];
		for (let t = 0; t < 61; t++) {
			step(s, FIRE, BOW);
			if (s.events.shotsFired !== 0) shots.push(t);
		}
		expect(shots).toEqual([0, 12, 24, 36, 48, 60]);
		expect(s.combat.playerSpawned).toBe(6); // single arrows
		for (const a of arrows(s)) {
			expect(a.speed).toBeCloseTo(BOW_DATA.speed, 9);
			expect(a.damage).toBe(BOW_DATA.damage);
			expect(a.pierce).toBe(0);
			expect(a.scale).toBe(1);
			expect(a.source).toBe(weaponIndex("weapon.bow") + 1);
		}
	});

	it("turns the stream by a fixed 4-step pattern (0, +a, 0, -a), a ~1.8 degrees, the first arrow exactly on the aim", () => {
		expect(math.atan2(BOW_WOBBLE_SIN, BOW_WOBBLE_COS)).toBeCloseTo(math.atan2(16, 63) / 8, 14);
		expect(BOW_WOBBLE_COS * BOW_WOBBLE_COS + BOW_WOBBLE_SIN * BOW_WOBBLE_SIN).toBeCloseTo(1, 15);
		const sides: number[] = [];
		const s = createSimState(1, 0, 0, BOW);
		for (let t = 0; t < 8 * 12; t++) {
			step(s, frame({ aimX: 600, aimZ: -800, buttons: Button.FIRE }), BOW);
			if (s.events.shotsFired === 0) continue;
			// The newest arrow: the one nearest the muzzle.
			const all = arrows(s);
			let a = all[0];
			for (const b of all) if (b.x * b.x + b.z * b.z < a.x * a.x + a.z * a.z) a = b;
			const ux = a.vx / a.speed;
			const uz = a.vz / a.speed;
			const dot = ux * 0.6 + uz * -0.8;
			const cross = 0.6 * uz - -0.8 * ux; // sign: which side of the aim
			if (dot > 1 - 1e-12) sides.push(0);
			else {
				expect(dot).toBeCloseTo(BOW_WOBBLE_COS, 12);
				sides.push(cross > 0 ? -1 : 1);
			}
		}
		expect(sides).toEqual([0, 1, 0, -1, 0, 1, 0, -1]);
	});

	it("does not fire while rolling or dead", () => {
		const s = createSimState(1, 0, 0, BOW);
		step(s, frame({ buttons: Button.ROLL + Button.FIRE }), BOW);
		expect(s.events.shotsFired).toBe(0);
		const d = createSimState(1, 0, 0, BOW);
		d.player.dead = 1;
		step(d, FIRE, BOW);
		expect(d.combat.playerSpawned).toBe(0);
	});
});

describe("bow: ALT charged shot", () => {
	it(`fires a heavy arrow when ALT is released after ${BOW_DATA.chargeTicks} ticks of charge, nothing if released earlier`, () => {
		expect(BOW_DATA.chargeTicks).toBe(36); // 0.6 s
		const early = createSimState(1, 0, 0, BOW);
		charge(early, BOW_DATA.chargeTicks - 1);
		expect(early.combat.playerSpawned).toBe(0);
		expect(early.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(0);

		const s = createSimState(1, 0, 0, BOW);
		for (let t = 0; t < BOW_DATA.chargeTicks; t++) {
			step(s, ALT, BOW);
			expect(s.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(t + 1);
		}
		for (let t = 0; t < 30; t++) step(s, ALT, BOW); // holding longer keeps it full
		expect(s.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(BOW_DATA.chargeTicks);
		expect(s.combat.playerSpawned).toBe(0);
		step(s, IDLE, BOW); // release
		expect(s.events.shotsFired).toBe(1);
		const all = arrows(s);
		expect(all.size()).toBe(1);
		const a = all[0];
		expect(a.damage).toBe(BOW_DATA.heavyDamage);
		expect(a.pierce).toBe(BOW_DATA.heavyPierce);
		expect(a.speed).toBeCloseTo(BOW_DATA.heavySpeed, 9);
		expect(a.scale).toBe(BOW_DATA.heavyScale);
		expect(a.x).toBeCloseTo(0, 12);
		expect(a.z).toBeCloseTo(PLAYER_MUZZLE_OFFSET + BOW_DATA.heavySpeed * SIM_DT, 9);
		// The stream waits heavyRecoverTicks after a heavy arrow.
		const shots: number[] = [];
		for (let t = 1; t <= BOW_DATA.heavyRecoverTicks + 1; t++) {
			step(s, FIRE, BOW);
			if (s.events.shotsFired !== 0) shots.push(t);
		}
		expect(shots).toEqual([BOW_DATA.heavyRecoverTicks]);
	});

	it("charging blocks the stream and halves walking; a roll or a SWAP cancels the charge", () => {
		const s = createSimState(1, 0, 0, BOW);
		const walk = PLAYER_SPEED * SIM_DT;
		step(s, frame({ moveX: 1000, buttons: Button.ALT + Button.FIRE }), BOW);
		expect(s.player.x).toBeCloseTo(walk, 12); // the slow starts next tick (stepPlayer runs before the weapons)
		for (let t = 0; t < 10; t++) step(s, frame({ moveX: 1000, buttons: Button.ALT + Button.FIRE }), BOW);
		expect(s.player.x).toBeCloseTo(walk + 10 * walk * BOW_DATA.chargeMoveMultiplier, 12);
		expect(s.combat.playerSpawned).toBe(0); // FIRE held all along: no stream while drawing
		// Roll: charge gone; still holding ALT after the roll charges again from zero.
		step(s, frame({ buttons: Button.ALT + Button.ROLL }), BOW);
		expect(s.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(0);
		while (s.player.rollTicks > 0) step(s, ALT, BOW); // the tick the roll ends already charges (1)
		step(s, ALT, BOW);
		expect(s.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(2);
		// SWAP away fully charged, back again: the charge is gone and releasing fires nothing.
		for (let t = 0; t < BOW_DATA.chargeTicks; t++) step(s, ALT, BOW);
		step(s, frame({ buttons: Button.ALT + Button.SWAP }), BOW);
		step(s, ALT, BOW);
		step(s, frame({ buttons: Button.ALT + Button.SWAP }), BOW);
		expect(s.combat.weapons.activeSet).toBe(0);
		expect(s.combat.weapons.sets[0].v[BOW_V_CHARGE]).toBe(0);
		step(s, IDLE, BOW);
		expect(s.combat.playerSpawned).toBe(0);
	});
});

describe("bow: piercing heavy arrow", () => {
	// A line of test.dummies (10 hp, radius 0.5) straight down the aim (+Z).
	const line = (zs: number[]): ActorSpawn[] => zs.map((z) => ({ kind: "test.dummy", x: 0, z }));
	const hps = (s: SimState): number[] => s.combat.actors.map((a) => a.hp);

	function flyHeavy(config: SimConfig): SimState {
		const s = createSimState(1, 0, 0, config);
		charge(s, BOW_DATA.chargeTicks, config);
		for (let t = 0; t < 60; t++) step(s, IDLE, config);
		return s;
	}

	it(`hits heavyPierce + 1 (${BOW_DATA.heavyPierce + 1}) actors once each, then it is consumed`, () => {
		const config = withBow(line([2, 3.5, 5, 6.5, 8]));
		const s = flyHeavy(config);
		const dmg = BOW_DATA.heavyDamage;
		expect(hps(s)).toEqual([10 - dmg, 10 - dmg, 10 - dmg, 10, 10]);
		expect(s.combat.playerBullets.activeCount).toBe(0);
	});

	it("hits each of several overlapping actors once (no ping-pong), and point-blank targets too", () => {
		const packed = flyHeavy(withBow(line([2, 2.6, 3.2])));
		expect(hps(packed)).toEqual([6, 6, 6]);
		const pointBlank = flyHeavy(withBow(line([0.7, 3])));
		expect(hps(pointBlank)).toEqual([6, 6]);
		expect(pointBlank.combat.playerBullets.activeCount).toBe(0); // lifetime / bounds, not a hit: only 2 actors
	});

	it("a stream arrow hits only the first actor and is consumed", () => {
		const config = withBow(line([2, 3.5]));
		const s = createSimState(1, 0, 0, config);
		step(s, FIRE, config);
		for (let t = 0; t < 40; t++) step(s, IDLE, config);
		expect(hps(s)).toEqual([10 - BOW_DATA.damage, 10]);
		expect(s.combat.playerBullets.activeCount).toBe(0);
	});

	it("kills with the same damage the payload says (12-hp turret: 3 heavy arrows, or 12 stream arrows)", () => {
		const config = withBow([{ kind: "turret.sniper", x: 0, z: 4 }]);
		const s = createSimState(1, 0, 0, config);
		s.player.iframeTicks = 100000; // test-only: ignore the turret's bullets
		let kills = 0;
		for (let k = 0; k < 3; k++) {
			for (let t = 0; t < BOW_DATA.chargeTicks; t++) step(s, ALT, config);
			step(s, IDLE, config);
			for (let t = 0; t < 30; t++) {
				step(s, IDLE, config);
				kills += s.events.enemiesKilled;
			}
		}
		expect(kills).toBe(1);
	});
});
