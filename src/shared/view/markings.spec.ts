// Floor marking geometry: dash layout, arcs, fans, the boss previews (with stand-in constants) and actor fx.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ACTOR_SCRATCH_SLOTS, AiState, DAMAGE_CAP_BUCKETS, NO_KIND, type ActorState } from "shared/sim";
import {
	TELEGRAPH_VIEW,
	actorFxMarkings,
	arc,
	bossTelegraphMarkings,
	dashLayout,
	fanLanes,
	heading,
	rect,
	roarMarkings,
	sector,
	type BossAct1Consts,
	type SegmentSink,
} from "shared/view";

class Collect implements SegmentSink {
	readonly segs = new Array<[number, number, number, number]>();
	seg(x0: number, z0: number, x1: number, z1: number): void {
		this.segs.push([x0, z0, x1, z1]);
	}
}

const near = (a: number, b: number) => math.abs(a - b) < 1e-9;

/** A free actor slot (all zeros), as the sim's createFreeActor makes it. */
function createFreeActor(): ActorState {
	return {
		id: 0,
		kind: NO_KIND,
		spawnTick: 0,
		x: 0,
		z: 0,
		prevX: 0,
		prevZ: 0,
		faceX: 0,
		faceZ: 1,
		hp: 0,
		hpMax: 0,
		radius: 0,
		alive: 0,
		deadTicks: 0,
		aiState: AiState.IDLE,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: table.create<number>(DAMAGE_CAP_BUCKETS, 0),
		v: table.create<number>(ACTOR_SCRATCH_SLOTS, 0),
	};
}

describe("dashLayout", () => {
	it("centres whole dashes on the line", () => {
		const l = dashLayout(10, 1, 0.75);
		expect(l.count).toBe(6); // 6 dashes + 5 gaps = 9.75
		const total = l.count * 1 + (l.count - 1) * 0.75;
		expect(l.first - 0.5).toBeCloseTo((10 - total) / 2, 12);
		expect(l.step).toBe(1.75);
		// last dash ends inside the line
		expect(l.first + (l.count - 1) * l.step + 0.5).toBeLessThanOrEqual(10 + 1e-9);
	});

	it("a short line still gets one centred dash; an empty one none", () => {
		const short = dashLayout(0.3, 1, 0.75);
		expect(short.count).toBe(1);
		expect(short.first).toBeCloseTo(0.15, 12);
		expect(dashLayout(0, 1, 0.75).count).toBe(0);
	});
});

describe("segments", () => {
	it("arcs stay on the circle and join end to end", () => {
		const c = new Collect();
		arc(c, 1, 2, 3, 0, math.pi);
		expect(c.segs.size()).toBeGreaterThan(2);
		for (const [x0, z0, x1, z1] of c.segs) {
			expect(math.sqrt((x0 - 1) * (x0 - 1) + (z0 - 2) * (z0 - 2))).toBeCloseTo(3, 9);
			expect(math.sqrt((x1 - 1) * (x1 - 1) + (z1 - 2) * (z1 - 2))).toBeCloseTo(3, 9);
		}
		for (let i = 1; i < c.segs.size(); i++) {
			expect(near(c.segs[i][0], c.segs[i - 1][2]) && near(c.segs[i][1], c.segs[i - 1][3])).toBe(true);
		}
		// heading 0 is +Z
		expect(c.segs[0][0]).toBeCloseTo(1, 9);
		expect(c.segs[0][1]).toBeCloseTo(5, 9);
	});

	it("heading matches the sim's convention (direction (sin h, cos h))", () => {
		expect(heading(0, 1)).toBe(0);
		expect(heading(1, 0)).toBeCloseTo(math.pi / 2, 12);
	});

	it("fan lanes: one ray per bullet, centred on the heading", () => {
		const c = new Collect();
		fanLanes(c, 0, 0, 0, 5, 1, 0.5, 7);
		expect(c.segs.size()).toBe(5);
		const mid = c.segs[2];
		expect(mid[0]).toBeCloseTo(0, 12);
		expect(mid[3]).toBeCloseTo(7, 12);
	});

	it("a sector has two edges, the outer arc and its fill arcs; a full circle has no edges", () => {
		const half = new Collect();
		sector(half, 0, 0, 0, 1, 2, 0.5, []);
		const filled = new Collect();
		sector(filled, 0, 0, 0, 1, 2, 0.5, [0.5]);
		expect(filled.segs.size()).toBeGreaterThan(half.segs.size());
		const full = new Collect();
		sector(full, 0, 0, 0, 1, 2, -1, []);
		for (const [x0, z0] of full.segs) expect(math.sqrt(x0 * x0 + z0 * z0)).toBeCloseTo(2, 9);
	});

	it("rect: four sides", () => {
		const c = new Collect();
		rect(c, 0, 0, 2, 3);
		expect(c.segs.size()).toBe(4);
	});

	it("roar: two rings", () => {
		const c = new Collect();
		roarMarkings(c, 0, 0, 0.5);
		expect(c.segs.size()).toBeGreaterThan(4);
	});
});

const CONSTS: BossAct1Consts = {
	attack: { FAN: 1, RING: 2, DOUBLE_RING: 3, SPIRAL: 4, SLAM: 5, FAST_FAN: 6 },
	state: { ACTIVE: 3, TRANSITION: 5 },
	telegraphTicks: [0, 36, 42, 48, 48, 54, 33, 0],
	fan: { count: 5, spread: 1 },
	fastFan: { count: 5, spread: 1 },
	ringArc: { count: 14, spread: math.pi - 0.9 },
	doubleRingArc: { count: 14, spread: math.pi - 0.9 },
	spiralArms: { count: 3, spread: 2 * math.pi },
	shockwave: { count: 26, spread: 2 * math.pi - 1 },
	shock2Turns: 2,
	turnAngle: 0.25,
	halfTurnAngle: 0.125,
	slots: { dirX: 0, dirZ: 1, auxX: 2, auxZ: 3, sign: 7, mark: 4 },
};

function boss(attack: number, aiTicks: number): ActorState {
	const a = createFreeActor();
	a.kind = 0;
	a.alive = 1;
	a.x = 10;
	a.z = 10;
	a.radius = 1.2;
	a.aiState = AiState.TELEGRAPH;
	a.attack = attack;
	a.aiTicks = aiTicks;
	a.v[0] = 0;
	a.v[1] = 1;
	a.v[2] = 1;
	a.v[3] = 0;
	a.v[7] = 1;
	return a;
}

describe("bossTelegraphMarkings", () => {
	it("fan: early in the wind-up dim, late bright; one lane per bullet", () => {
		const bright = new Collect();
		const dim = new Collect();
		bossTelegraphMarkings(bright, dim, boss(CONSTS.attack.FAN, 35), CONSTS, 0);
		expect(dim.segs.size()).toBe(5);
		expect(bright.segs.size()).toBe(0);
		const b2 = new Collect();
		const d2 = new Collect();
		bossTelegraphMarkings(b2, d2, boss(CONSTS.attack.FAN, TELEGRAPH_VIEW.blinkTicks + 1), CONSTS, 0);
		expect(b2.segs.size()).toBe(5);
	});

	it("fast fan adds dim offset lanes; every attack draws something", () => {
		const bright = new Collect();
		const dim = new Collect();
		bossTelegraphMarkings(bright, dim, boss(CONSTS.attack.FAST_FAN, 1), CONSTS, 0);
		expect(bright.segs.size() + dim.segs.size()).toBe(10);
		for (const attack of [
			CONSTS.attack.RING,
			CONSTS.attack.DOUBLE_RING,
			CONSTS.attack.SPIRAL,
			CONSTS.attack.SLAM,
		]) {
			const b = new Collect();
			const d = new Collect();
			bossTelegraphMarkings(b, d, boss(attack, 20), CONSTS, 0);
			expect(b.segs.size() + d.segs.size()).toBeGreaterThan(0);
		}
	});

	it("blinks between the layers in the last ticks", () => {
		const a = boss(CONSTS.attack.FAN, 2);
		const on = new Collect();
		const onDim = new Collect();
		bossTelegraphMarkings(on, onDim, a, CONSTS, 0);
		const off = new Collect();
		const offDim = new Collect();
		bossTelegraphMarkings(off, offDim, a, CONSTS, TELEGRAPH_VIEW.blinkPeriodTicks);
		expect(on.segs.size()).toBe(5);
		expect(offDim.segs.size()).toBe(5);
	});
});

describe("actorFxMarkings", () => {
	it("draws the aim line while winding up (bold at the end) and the shockwave while it runs", () => {
		const a = createFreeActor();
		a.kind = 0;
		a.alive = 1;
		a.aiState = AiState.TELEGRAPH;
		a.aiTicks = 30;
		a.v[3] = 1;
		a.v[4] = 0;
		a.v[5] = 6;
		const fx = { aimLine: { dirX: 3, dirZ: 4, lenSlot: 5, boldTicks: 10 } };
		const bright = new Collect();
		const dim = new Collect();
		expect(actorFxMarkings(bright, dim, a, fx, 0, 0, 0)).toBe(true);
		expect(dim.segs).toEqual([[0, 0, 6, 0]]);
		a.aiTicks = 5;
		actorFxMarkings(bright, dim, a, fx, 0, 0, 0);
		expect(bright.segs.size()).toBe(1);

		const waveState = AiState.CUSTOM + 3;
		const wave = {
			shockwave: {
				state: waveState,
				startTicks: 20,
				showTicks: 20,
				radius: 1,
				speed: 6,
				gapX: 3,
				gapZ: 4,
				gapHalfAngle: 0.5,
			},
		};
		a.aiState = waveState;
		a.aiTicks = 15; // age 5
		const b2 = new Collect();
		const d2 = new Collect();
		expect(actorFxMarkings(b2, d2, a, wave, 0, 0, 0)).toBe(true);
		expect(b2.segs.size()).toBeGreaterThan(0);
		a.aiTicks = -5; // age 25: past showTicks
		expect(actorFxMarkings(new Collect(), new Collect(), a, wave, 0, 0, 0)).toBe(false);
	});

	it("an aim clip shortens the aim line (an intact breakable in the way)", () => {
		const a = createFreeActor();
		a.kind = 0;
		a.alive = 1;
		a.aiState = AiState.TELEGRAPH;
		a.aiTicks = 30;
		a.v[3] = 1;
		a.v[4] = 0;
		a.v[5] = 6;
		const fx = { aimLine: { dirX: 3, dirZ: 4, lenSlot: 5, boldTicks: 10 } };
		const dim = new Collect();
		const asked = new Array<number>();
		actorFxMarkings(new Collect(), dim, a, fx, 2, 1, 0, (x, z, dx, dz, len) => {
			asked.push(x, z, dx, dz, len);
			return 2.5;
		});
		expect(asked).toEqual([2, 1, 1, 0, 6]);
		expect(dim.segs).toEqual([[2, 1, 4.5, 1]]);
	});
});
