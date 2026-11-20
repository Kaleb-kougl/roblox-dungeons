// Sword spacing SP1 (docs/SWORD_SPACING.md Design 1-2): the spacing list and brakeStep's contract. Specs may use trig
// (the determinism rules bind the sim, not its specs).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BRAKE_RESULT,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	Rng,
	SWORD_SPACING,
	SimCtx,
	brakeStep,
	buildSpacingList,
	clearSpacingList,
	createSimState,
	newSpacingList,
	pushSpacingEntry,
	type SpacingList,
} from "shared/sim";

const CONE = SWORD_SPACING.stopConeCos;
/** A swarmer's keep: radius 0.3 + PLAYER_RADIUS 0.35 + margin 0.15. */
const SWARMER_KEEP = 0.3 + PLAYER_RADIUS + SWORD_SPACING.marginTiles;
/** Full walk speed, tiles a tick (6 tiles/s). */
const WALK = 0.1;

function listOf(entries: ReadonlyArray<[number, number, number]>): SpacingList {
	const list = newSpacingList();
	for (const [x, z, keep] of entries) pushSpacingEntry(list, x, z, keep);
	return list;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
	return math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

/** The 8 key directions (45 degrees apart), unit length. */
function keyDirections(): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let k = 0; k < 8; k++) out.push([math.cos((k * math.pi) / 4), math.sin((k * math.pi) / 4)]);
	return out;
}

/** The key direction nearest to (bx, bz), scaled to the walk (a keyboard player holding toward a target). */
function nearestKey(bx: number, bz: number): [number, number] {
	let best = -2;
	let bestX = 0;
	let bestZ = 0;
	const len = math.sqrt(bx * bx + bz * bz);
	for (const [kx, kz] of keyDirections()) {
		const c = (kx * bx + kz * bz) / len;
		if (c > best) {
			best = c;
			bestX = kx;
			bestZ = kz;
		}
	}
	return [bestX * WALK, bestZ * WALK];
}

function isNegZero(v: number): boolean {
	return v === 0 && 1 / v < 0;
}

describe("brakeStep", () => {
	it("returns the step bit for bit with an empty list or far from every entry", () => {
		const empty = newSpacingList();
		const far = listOf([
			[10, 10, SWARMER_KEEP],
			[-5, 3, 1.7],
		]);
		const steps: Array<[number, number]> = [
			[0.1, 0],
			[-0, 0.1],
			[0.07071067811865475, -0.07071067811865475],
			[1 / 3, -1 / 7],
			[0, 0],
		];
		for (const list of [empty, far])
			for (const [dx, dz] of steps) {
				brakeStep(list, 0.3, -0.2, dx, dz, CONE);
				expect(BRAKE_RESULT.x).toBe(dx);
				expect(BRAKE_RESULT.z).toBe(dz);
				expect(isNegZero(BRAKE_RESULT.x)).toBe(isNegZero(dx));
				expect(BRAKE_RESULT.engaged).toBe(false);
			}
	});

	it("head-on at a swarmer from 2 tiles at full walk stops within 1e-9 of keep, never inside", () => {
		const list = listOf([[0, 0, SWARMER_KEEP]]);
		let px = 0;
		let pz = -2;
		let engagedTicks = 0;
		for (let t = 0; t < 40; t++) {
			brakeStep(list, px, pz, 0, WALK, CONE);
			if (BRAKE_RESULT.engaged) engagedTicks++;
			px += BRAKE_RESULT.x;
			pz += BRAKE_RESULT.z;
			expect(dist(px, pz, 0, 0) >= SWARMER_KEEP - 1e-12).toBe(true);
		}
		expect(math.abs(dist(px, pz, 0, 0) - SWARMER_KEEP) <= 1e-9).toBe(true);
		expect(px).toBe(0);
		expect(engagedTicks > 20).toBe(true);
	});

	it("a key held within 22.5 degrees of a swarmer stops dead at keep, with no sideways drift", () => {
		const bearings = [-22.5, -20, -12, -5, 0, 3, 11, 17.5, 22.5];
		for (const [kx, kz] of keyDirections())
			for (const deg of bearings) {
				// The swarmer just past keep, `deg` off the key: the next step would end inside.
				const r = math.rad(deg);
				const bx = kx * math.cos(r) - kz * math.sin(r);
				const bz = kx * math.sin(r) + kz * math.cos(r);
				const ex = bx * (SWARMER_KEEP + 0.05);
				const ez = bz * (SWARMER_KEEP + 0.05);
				const list = listOf([[ex, ez, SWARMER_KEEP]]);
				let px = 0;
				let pz = 0;
				const path: Array<[number, number]> = [];
				for (let t = 0; t < 20; t++) {
					brakeStep(list, px, pz, kx * WALK, kz * WALK, CONE);
					px += BRAKE_RESULT.x;
					pz += BRAKE_RESULT.z;
					path.push([px, pz]);
					expect(dist(px, pz, ex, ez) >= SWARMER_KEEP - 1e-12).toBe(true);
				}
				expect(math.abs(dist(px, pz, ex, ez) - SWARMER_KEEP) <= 1e-9).toBe(true);
				// Stopped on the first tick and stayed: no drift round the enemy.
				for (let t = 1; t < 20; t++)
					expect(dist(path[t][0], path[t][1], path[0][0], path[0][1]) <= 1e-12).toBe(true);
				// On the line from the start to the enemy: nothing sideways.
				expect(math.abs(px * bz - pz * bx) <= 1e-12).toBe(true);
			}
	});

	it("a keyboard player chasing a swarmer with the nearest key stops at keep from any bearing", () => {
		for (let k = 0; k < 72; k++) {
			const r = (k * math.pi) / 36;
			const ex = 2 * math.cos(r);
			const ez = 2 * math.sin(r);
			const list = listOf([[ex, ez, SWARMER_KEEP]]);
			let px = 0;
			let pz = 0;
			let lastX = 0;
			let lastZ = 0;
			for (let t = 0; t < 60; t++) {
				const [dx, dz] = nearestKey(ex - px, ez - pz);
				brakeStep(list, px, pz, dx, dz, CONE);
				px += BRAKE_RESULT.x;
				pz += BRAKE_RESULT.z;
				expect(dist(px, pz, ex, ez) >= SWARMER_KEEP - 1e-12).toBe(true);
				if (t === 49) {
					lastX = px;
					lastZ = pz;
				}
			}
			expect(math.abs(dist(px, pz, ex, ez) - SWARMER_KEEP) <= 1e-9).toBe(true);
			expect(dist(px, pz, lastX, lastZ) <= 1e-12).toBe(true);
		}
	});

	it("a key 45 degrees off a swarmer slides round it: never inside, never against the input", () => {
		for (const [kx, kz] of keyDirections())
			for (const side of [-1, 1]) {
				const r = (side * math.pi) / 4;
				const bx = kx * math.cos(r) - kz * math.sin(r);
				const bz = kx * math.sin(r) + kz * math.cos(r);
				const ex = bx * (SWARMER_KEEP + 0.05);
				const ez = bz * (SWARMER_KEEP + 0.05);
				const list = listOf([[ex, ez, SWARMER_KEEP]]);
				let px = 0;
				let pz = 0;
				let engaged = 0;
				for (let t = 0; t < 40; t++) {
					brakeStep(list, px, pz, kx * WALK, kz * WALK, CONE);
					if (BRAKE_RESULT.engaged) engaged++;
					expect(BRAKE_RESULT.x * kx + BRAKE_RESULT.z * kz > 0).toBe(true); // always some progress
					px += BRAKE_RESULT.x;
					pz += BRAKE_RESULT.z;
					expect(dist(px, pz, ex, ez) >= SWARMER_KEEP - 1e-9).toBe(true);
				}
				expect(engaged > 0).toBe(true);
				// It went round and on: well past the enemy along the key.
				expect(px * kx + pz * kz > 2).toBe(true);
			}
	});

	it("an enemy that starts inside keep: away and along pass, inward is removed, nothing pushes out", () => {
		const list = listOf([[0, 0, SWARMER_KEEP]]);
		const pz = -0.5;
		// Away.
		brakeStep(list, 0, pz, 0, -WALK, CONE);
		expect(BRAKE_RESULT.x).toBe(0);
		expect(BRAKE_RESULT.z).toBe(-WALK);
		expect(BRAKE_RESULT.engaged).toBe(false);
		// Along (perpendicular to the centre).
		brakeStep(list, 0, pz, WALK, 0, CONE);
		expect(BRAKE_RESULT.x).toBe(WALK);
		expect(BRAKE_RESULT.z).toBe(0);
		// Straight in: inside the stop cone, nothing is left.
		brakeStep(list, 0, pz, 0, WALK, CONE);
		expect(BRAKE_RESULT.x).toBe(0);
		expect(BRAKE_RESULT.z).toBe(0);
		expect(BRAKE_RESULT.engaged).toBe(true);
		// In at 45 degrees: the inward part goes, the tangential part stays.
		const h = WALK * math.sqrt(0.5);
		brakeStep(list, 0, pz, h, h, CONE);
		expect(math.abs(BRAKE_RESULT.x - h) <= 1e-15).toBe(true);
		expect(math.abs(BRAKE_RESULT.z) <= 1e-15).toBe(true);
		expect(dist(BRAKE_RESULT.x, pz + BRAKE_RESULT.z, 0, 0) >= 0.5).toBe(true);
		// No step, no push.
		brakeStep(list, 0, pz, 0, 0, CONE);
		expect(BRAKE_RESULT.x).toBe(0);
		expect(BRAKE_RESULT.z).toBe(0);
		expect(BRAKE_RESULT.engaged).toBe(false);
	});

	it("two swarmers side by side: no squeeze inside either keep", () => {
		for (const gap of [0.6, 1.0, 1.4, 1.7])
			for (const startX of [-0.6, -0.2, 0, 0.13, 0.5])
				for (const mode of [0, 1]) {
					const ax = -gap / 2;
					const bx = gap / 2;
					const list = listOf([
						[ax, 0, SWARMER_KEEP],
						[bx, 0, SWARMER_KEEP],
					]);
					let px = startX;
					let pz = -2;
					for (let t = 0; t < 60; t++) {
						const [dx, dz] = mode === 0 ? [0, WALK] : nearestKey(-px, -pz);
						brakeStep(list, px, pz, dx, dz, CONE);
						expect(BRAKE_RESULT.x * dx + BRAKE_RESULT.z * dz >= -1e-12).toBe(true);
						px += BRAKE_RESULT.x;
						pz += BRAKE_RESULT.z;
						expect(dist(px, pz, ax, 0) >= SWARMER_KEEP - 1e-9).toBe(true);
						expect(dist(px, pz, bx, 0) >= SWARMER_KEEP - 1e-9).toBe(true);
					}
				}
	});

	it("an exact overlap (d = 0) is deterministic: every step moves away, so it passes", () => {
		const list = listOf([
			[1.25, -0.5, SWARMER_KEEP],
			[1.25, -0.5, 1.7],
		]);
		for (const [dx, dz] of [
			[0.1, 0],
			[-0.03, 0.08],
			[0, 0],
		]) {
			brakeStep(list, 1.25, -0.5, dx, dz, CONE);
			const x1 = BRAKE_RESULT.x;
			const z1 = BRAKE_RESULT.z;
			brakeStep(list, 1.25, -0.5, dx, dz, CONE);
			expect(BRAKE_RESULT.x).toBe(x1);
			expect(BRAKE_RESULT.z).toBe(z1);
			expect(x1).toBe(dx);
			expect(z1).toBe(dz);
		}
	});

	it("fuzz: the contract holds for 100,000 random lists, starts and steps", () => {
		const rng = new Rng(0x5a1e5a1e);
		const list = newSpacingList();
		const cones = [CONE, 1, 0.5, 0];
		let failures = 0;
		let firstFailure = "";
		let engagedCases = 0;
		const n = 100000;
		for (let c = 0; c < n; c++) {
			clearSpacingList(list);
			const count = rng.int(0, 4);
			const px = rng.next() * 4 - 2;
			const pz = rng.next() * 4 - 2;
			for (let i = 0; i < count; i++) {
				const keep = 0.8 + rng.next() * 0.9;
				pushSpacingEntry(list, px + rng.next() * 4 - 2, pz + rng.next() * 4 - 2, keep);
			}
			const dx = rng.next() * 0.4 - 0.2;
			const dz = rng.next() * 0.4 - 0.2;
			const cone = c % 5 === 4 ? rng.next() : cones[c % 4];
			brakeStep(list, px, pz, dx, dz, cone);
			const rx = BRAKE_RESULT.x;
			const rz = BRAKE_RESULT.z;
			const engaged = BRAKE_RESULT.engaged;
			if (engaged) engagedCases++;
			let bad = "";
			if (math.sqrt(rx * rx + rz * rz) > math.sqrt(dx * dx + dz * dz) + 1e-12) bad = "longer than the step";
			else if (rx * dx + rz * dz < -1e-12) bad = "against the step";
			else if (engaged !== (rx !== dx || rz !== dz)) bad = "engaged flag";
			else if (!engaged && (rx !== dx || rz !== dz)) bad = "not identity";
			else
				for (let i = 0; i < list.count; i++) {
					const d = dist(px, pz, list.x[i], list.z[i]);
					const e = dist(px + rx, pz + rz, list.x[i], list.z[i]);
					if (e < math.min(d, list.keep[i]) - 1e-9) bad = `inside entry ${i} (start ${d}, end ${e})`;
				}
			brakeStep(list, px, pz, dx, dz, cone);
			if (bad === "" && (BRAKE_RESULT.x !== rx || BRAKE_RESULT.z !== rz)) bad = "not deterministic";
			if (bad !== "") {
				failures++;
				if (firstFailure === "") firstFailure = `case ${c}: ${bad}`;
			}
		}
		expect(firstFailure).toBe("");
		expect(failures).toBe(0);
		expect(engagedCases > n / 20).toBe(true);
	});
});

describe("buildSpacingList", () => {
	it("pushes live contact enemies in slot order and skips dead, free and harmless slots", () => {
		const s = createSimState(1, 0, 0);
		const ctx = new SimCtx().bind(s, {}, EMPTY_INPUT);
		const a = ctx.spawnActor("swarmer", 1, 0)!; // slot 0
		ctx.spawnActor("sniper", 2, 0); // slot 1: no contact damage
		const b = ctx.spawnActor("bruiser", 3, -1)!; // slot 2
		const dead = ctx.spawnActor("swarmer", 4, 0)!; // slot 3
		const freed = ctx.spawnActor("swarmer", 5, 0)!; // slot 4
		const c = ctx.spawnActor("swarmer", -6, 2)!; // slot 5
		ctx.killActor(dead);
		ctx.freeActor(freed);
		expect(s.combat.actors[5]).toBe(c);

		const list = newSpacingList();
		pushSpacingEntry(list, 99, 99, 99); // cleared first
		buildSpacingList(s, SWORD_SPACING, list);
		expect(list.count).toBe(3);
		const want = [a, b, c];
		for (let i = 0; i < 3; i++) {
			expect(list.x[i]).toBe(want[i].x);
			expect(list.z[i]).toBe(want[i].z);
			expect(list.keep[i]).toBe(want[i].radius + PLAYER_RADIUS + SWORD_SPACING.marginTiles);
		}
		expect(list.keep[0]).toBe(SWARMER_KEEP);

		// Rebuilt into the same list: same entries, the arrays reused.
		buildSpacingList(s, SWORD_SPACING, list);
		expect(list.count).toBe(3);
		expect(list.x.size()).toBe(3);
		buildSpacingList(s, { ...SWORD_SPACING, marginTiles: 0 }, list);
		expect(list.keep[1]).toBe(b.radius + PLAYER_RADIUS);
	});
});
