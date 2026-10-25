// E1.8 room enemies (swarmer, sniper, bruiser; source: src/sim/actors/archetypes/enemies.test.ts): behaviour in small
// hand-built arenas (no dungeon; a test wall where line of sight matters), plus the shared aggro / alert / leash rules.
import { describe, expect, it } from "@rbxts/jest-globals";
import { hypot2, jsRound, stableSort } from "shared/jsmath";
import {
	AiState,
	BRUISER,
	BRUISER_ATTACK_SLAM,
	BRUISER_GAP_X,
	BRUISER_GAP_Z,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	HIT_HEAVY,
	HIT_NORMAL,
	PLAYER_RADIUS,
	RING_GAP_ANGLE,
	RING_GAP_SLOTS,
	RING_SLOTS,
	SIM_DT,
	SNIPER,
	SNIPER_AIM_LEN,
	SNIPER_AIM_X,
	SNIPER_AIM_Z,
	SNIPER_ATTACK_LINE,
	START_HALF_HEARTS,
	STATE_ENGAGED,
	STATE_RETURN,
	SWARMER,
	SWARMER_ATTACK_LUNGE,
	SWARMER_LUNGE,
	SimCtx,
	V_AGGRO,
	V_HOME_X,
	V_HOME_Z,
	archetypeIndex,
	createSimState,
	step,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

/**
 * A wall of blocked tiles along x = wallX (tile centers at integers), for |z| <= half, while `up()` says so;
 * everything else open.
 */
function wallConfig(spawns: ActorSpawn[], wallX: number, half = 6, up: () => boolean = () => true): SimConfig {
	const blocked = (x: number, z: number): boolean => up() && jsRound(x) === wallX && math.abs(jsRound(z)) <= half;
	return {
		encounter: enc(spawns),
		isBulletBlocked: blocked,
		// Actors stop at the wall (good enough for these tests: a move ending in a blocked tile is refused).
		actorMover: (x, z, dx, dz) => (blocked(x + dx, z + dz) ? { x, z } : { x: x + dx, z: z + dz }),
	};
}

const run = (s: SimState, n: number, config: SimConfig, each?: (t: number) => void): void => {
	for (let i = 0; i < n; i++) {
		step(s, EMPTY_INPUT, config);
		if (each !== undefined) each(i);
	}
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => hypot2(a.x - b.x, a.z - b.z);
/** The player can't be hurt for a while (bullets pass through: they are consumed only when a hit lands). */
const ghost = (s: SimState): void => {
	s.player.hurtTicks = 1e6;
};
/** atan2(sin(v), cos(v)): an angle wrapped into (-PI, PI] (test code: trig is fine here). */
const wrap = (v: number): number => math.atan2(math.sin(v), math.cos(v));

describe("swarmer", () => {
	it("idles until the player is in range, then chases and deals HIT_NORMAL on contact", () => {
		const config: SimConfig = { encounter: enc([{ kind: "swarmer", x: 0, z: 12 }]) };
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		run(s, 60, config);
		expect([a.x, a.z]).toEqual([0, 12]); // out of aggroRange (8): stays home
		expect(a.v[V_AGGRO]).toBe(0);
		s.player.z = 6; // walk into range (test teleport)
		s.player.prevZ = 6;
		let hitTick = -1;
		run(s, 240, config, (t) => {
			if (hitTick < 0 && s.events.playerHits > 0) hitTick = t;
		});
		expect(a.v[V_AGGRO]).toBe(1);
		expect(hitTick).toBeGreaterThan(0);
		expect(s.player.hearts).toBeLessThan(START_HALF_HEARTS);
		expect(SWARMER.data.contactDamage).toBe(HIT_NORMAL);
		expect(s.events.lastHitSource === -1 || s.events.lastHitSource === archetypeIndex("swarmer")).toBe(true);
	});

	it("names itself as the hit source on contact", () => {
		const config: SimConfig = { encounter: enc([{ kind: "swarmer", x: 0, z: 0.4 }]) };
		const s = createSimState(1, 0, 0, config);
		step(s, EMPTY_INPUT, config);
		expect(s.events.playerHits).toBe(1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(s.events.lastHitSource).toBe(archetypeIndex("swarmer"));
	});

	it("winds up 0.4 s (standing still, direction locked) before a ~2.75 unit lunge", () => {
		const config: SimConfig = { encounter: enc([{ kind: "swarmer", x: 0, z: 2.5 }]) };
		const s = createSimState(3, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		let teleTick = -1;
		let lungeTick = -1;
		let teleX = 0;
		let teleZ = 0;
		let lungeEndTick = -1;
		let endX = 0;
		let endZ = 0;
		run(s, 200, config, (t) => {
			if (teleTick < 0 && s.events.telegraphs > 0) {
				teleTick = t;
				teleX = a.x;
				teleZ = a.z;
				expect(a.attack).toBe(SWARMER_ATTACK_LUNGE);
			}
			if (teleTick >= 0 && lungeTick < 0 && a.aiState === AiState.TELEGRAPH) {
				expect([a.x, a.z]).toEqual([teleX, teleZ]); // planted during the wind-up
			}
			if (teleTick >= 0 && lungeTick < 0 && a.aiState === SWARMER_LUNGE) lungeTick = t;
			if (lungeTick >= 0 && lungeEndTick < 0 && a.aiState !== SWARMER_LUNGE) {
				lungeEndTick = t;
				endX = a.x;
				endZ = a.z;
			}
		});
		expect(teleTick).toBeGreaterThanOrEqual(0);
		const windup = (lungeTick - teleTick) * SIM_DT;
		expect(lungeTick - teleTick).toBe(SWARMER.data.lungeTelegraphTicks);
		expect(windup).toBeGreaterThanOrEqual(0.3);
		expect(windup).toBeLessThanOrEqual(0.5);
		// The lunge: straight down the locked direction (at the player), about lungeSpeed * lungeTicks long.
		expect(lungeEndTick).toBeGreaterThan(lungeTick);
		expect(lungeEndTick - lungeTick).toBe(SWARMER.data.lungeTicks);
		const reach = dist({ x: endX, z: endZ }, { x: teleX, z: teleZ });
		expect(reach).toBeCloseTo((SWARMER.data.lungeSpeed * SWARMER.data.lungeTicks) / 60, 5);
		expect(endX).toBeCloseTo(teleX, 9); // straight along -z, through where the player stood
		expect(endZ).toBeLessThan(0);
	});

	it("packs separate: six swarmers stacked on one point spread out, idle and while chasing", () => {
		const stack = (z: number): ActorSpawn[] => {
			const out: ActorSpawn[] = [];
			for (let i = 0; i < 6; i++) out.push({ kind: "swarmer", x: 0.5, z });
			return out;
		};
		const minPair = (actors: ActorState[]): number => {
			let m = math.huge;
			for (let i = 0; i < actors.size(); i++) {
				for (let j = i + 1; j < actors.size(); j++) m = math.min(m, dist(actors[i], actors[j]));
			}
			return m;
		};
		// Idle (player far away): they push apart to about the separation distance.
		const idleCfg: SimConfig = { encounter: enc(stack(30)) };
		const idle = createSimState(1, 0, 0, idleCfg);
		expect(minPair(idle.combat.actors)).toBe(0);
		run(idle, 120, idleCfg);
		expect(minPair(idle.combat.actors)).toBeGreaterThan(SWARMER.data.separation * 0.9);
		// Chasing (player 6 away, can't be hurt so the chase goes on): they stay apart while converging on the player.
		const chaseCfg: SimConfig = { encounter: enc(stack(6)) };
		const chase = createSimState(1, 0, 0, chaseCfg);
		ghost(chase);
		let crowded = 0;
		run(chase, 180, chaseCfg, (t) => {
			if (t >= 30 && minPair(chase.combat.actors) < 0.25) crowded++; // lunges cross briefly; nothing persists
		});
		expect(chase.combat.actors.every((a) => a.v[V_AGGRO] === 1)).toBe(true);
		expect(crowded).toBeLessThan(150 * 0.15);
		// Surrounding the (unhittable) player: spread around it, not stacked on it.
		expect(minPair(chase.combat.actors)).toBeGreaterThan(0.4);
		const touching = chase.combat.actors.filter((a) => dist(a, chase.player) < a.radius + PLAYER_RADIUS);
		expect(touching.size()).toBeGreaterThanOrEqual(3); // the rest are mid-lunge / recovering nearby
		for (const a of chase.combat.actors) expect(dist(a, chase.player)).toBeLessThan(3.2);
		// Deterministic split: same inputs, same positions.
		const again = createSimState(1, 0, 0, chaseCfg);
		ghost(again);
		run(again, 180, chaseCfg);
		expect(again.combat.actors.map((a) => [a.x, a.z])).toEqual(chase.combat.actors.map((a) => [a.x, a.z]));
	});
});

describe("sniper", () => {
	it("keeps mid range: backs off when the player is close, closes in when far", () => {
		const near: SimConfig = { encounter: enc([{ kind: "sniper", x: 0, z: 2.5 }]) };
		const s = createSimState(1, 0, 0, near);
		ghost(s);
		run(s, 240, near);
		expect(dist(s.combat.actors[0], s.player)).toBeGreaterThanOrEqual(SNIPER.data.keepMin - 0.2);
		expect(dist(s.combat.actors[0], s.player)).toBeLessThanOrEqual(SNIPER.data.keepMax + 0.2);

		const far: SimConfig = { encounter: enc([{ kind: "sniper", x: 0, z: 9.5 }]) };
		const f = createSimState(1, 0, 0, far);
		ghost(f);
		run(f, 300, far);
		expect(dist(f.combat.actors[0], f.player)).toBeLessThanOrEqual(SNIPER.data.keepMax + 0.2);
		expect(dist(f.combat.actors[0], f.player)).toBeGreaterThanOrEqual(SNIPER.data.keepMin - 0.2);
	});

	it("telegraphs 0.6 s along its aim line, then fires a 3-shot line down it", () => {
		const config: SimConfig = { encounter: enc([{ kind: "sniper", x: 0, z: 6 }]) };
		const s = createSimState(1, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		let teleTick = -1;
		let fireTick = -1;
		let fired = 0;
		run(s, 300, config, (t) => {
			if (teleTick < 0 && s.events.telegraphs > 0) {
				teleTick = t;
				expect(a.attack).toBe(SNIPER_ATTACK_LINE);
				expect(a.v[SNIPER_AIM_LEN]).toBeGreaterThan(5); // open arena: the full warning line
				expect(hypot2(a.v[SNIPER_AIM_X], a.v[SNIPER_AIM_Z])).toBeCloseTo(1, 9);
			}
			if (teleTick >= 0 && fireTick < 0 && s.combat.enemySpawned > 0) {
				fireTick = t;
				fired = s.combat.enemySpawned;
			}
		});
		expect(teleTick).toBeGreaterThanOrEqual(0);
		expect(fireTick - teleTick).toBe(SNIPER.data.telegraphTicks);
		expect((fireTick - teleTick) * SIM_DT).toBeCloseTo(0.6, 9);
		expect(fired).toBe(3);
	});

	it("the three shots fly down one line (the locked aim), fastest first", () => {
		const config: SimConfig = { encounter: enc([{ kind: "sniper", x: 3, z: 6 }]) };
		const s = createSimState(1, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		let aimX = 0;
		let aimZ = 0;
		let ox = 0;
		let oz = 0;
		for (let t = 0; t < 300 && s.combat.enemySpawned === 0; t++) {
			step(s, EMPTY_INPUT, config);
			aimX = a.v[SNIPER_AIM_X];
			aimZ = a.v[SNIPER_AIM_Z];
			ox = a.x;
			oz = a.z;
		}
		run(s, 10, config);
		const along: number[] = [];
		s.combat.enemyBullets.forEachActive((_i, p) => {
			const rx = p.x - ox;
			const rz = p.z - oz;
			expect(math.abs(rx * aimZ - rz * aimX)).toBeLessThan(1e-6); // on the aim line
			along.push(rx * aimX + rz * aimZ);
			return false;
		});
		expect(along.size()).toBe(3);
		const desc = stableSort(along, (x, y) => y - x);
		expect(desc[0] - desc[1]).toBeGreaterThan(0.2); // stretched into a line
		expect(desc[1] - desc[2]).toBeGreaterThan(0.2);
	});

	it("never fires without line of sight: a wall between keeps it idle, and being hit engages it but it still holds fire", () => {
		const config = wallConfig([{ kind: "sniper", x: 6, z: 0 }], 3);
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		run(s, 240, config);
		expect(a.v[V_AGGRO]).toBe(0);
		expect(s.combat.enemySpawned).toBe(0);
		new SimCtx().bind(s, config, EMPTY_INPUT).damageActor(a, 1); // shot from out of sight: engages
		expect(a.v[V_AGGRO]).toBe(1);
		let telegraphs = 0;
		run(s, 240, config, () => {
			telegraphs += s.events.telegraphs;
		});
		expect(telegraphs).toBe(0);
		expect(s.combat.enemySpawned).toBe(0);
	});

	it("cancels a volley when line of sight breaks during the wind-up", () => {
		let wallUp = false;
		const config = wallConfig([{ kind: "sniper", x: 6, z: 0 }], 3, 50, () => wallUp);
		const s = createSimState(1, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		for (let t = 0; t < 300 && s.events.telegraphs === 0; t++) step(s, EMPTY_INPUT, config);
		expect(a.aiState).toBe(AiState.TELEGRAPH);
		wallUp = true; // a wall rises between them (stands in for the player ducking behind cover)
		expect(a.x).toBeGreaterThan(3.5);
		run(s, SNIPER.data.telegraphTicks + 2, config);
		expect(s.combat.enemySpawned).toBe(0);
		expect(a.aiState).never.toBe(AiState.TELEGRAPH);
		expect(a.attack).toBe(0);
		expect(a.cooldown).toBeGreaterThan(0);
	});
});

describe("bruiser", () => {
	it("touching it costs a full heart (HIT_HEAVY), naming the bruiser", () => {
		const config: SimConfig = { encounter: enc([{ kind: "bruiser", x: 0, z: 0.6 }]) };
		const s = createSimState(1, 0, 0, config);
		step(s, EMPTY_INPUT, config);
		expect(BRUISER.data.contactDamage).toBe(HIT_HEAVY);
		expect(s.events.playerHits).toBe(1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_HEAVY);
		expect(s.events.lastHitSource).toBe(archetypeIndex("bruiser"));
	});

	it("telegraphs 0.7 s, then slams a ring of slow bullets with one gap near the player", () => {
		const config: SimConfig = { encounter: enc([{ kind: "bruiser", x: 0, z: 2.4 }]) };
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		let teleTick = -1;
		let fireTick = -1;
		for (let t = 0; t < 300 && fireTick < 0; t++) {
			step(s, EMPTY_INPUT, config);
			if (teleTick < 0 && s.events.telegraphs > 0) {
				teleTick = t;
				expect(a.attack).toBe(BRUISER_ATTACK_SLAM);
			}
			if (teleTick >= 0 && a.aiState === AiState.TELEGRAPH) expect(a.x === a.prevX && a.z === a.prevZ).toBe(true);
			if (s.combat.enemySpawned > 0) fireTick = t;
		}
		expect(teleTick).toBeGreaterThanOrEqual(0);
		expect(fireTick - teleTick).toBe(BRUISER.data.telegraphTicks);
		expect((fireTick - teleTick) * SIM_DT).toBeCloseTo(0.7, 9);
		expect(s.combat.enemySpawned).toBe(RING_SLOTS - RING_GAP_SLOTS);

		// Bullet bearings around the bruiser (test code: trig is fine here).
		const bearings: number[] = [];
		let minR = math.huge;
		s.combat.enemyBullets.forEachActive((_i, p) => {
			bearings.push(math.atan2(p.x - a.x, p.z - a.z));
			minR = math.min(minR, hypot2(p.x - a.x, p.z - a.z));
			return false;
		});
		expect(bearings.size()).toBe(RING_SLOTS - RING_GAP_SLOTS);
		const angles = stableSort(bearings, (x, y) => x - y);
		const gaps = angles.map((v, i) => (i + 1 < angles.size() ? angles[i + 1] - v : angles[0] + 2 * math.pi - v));
		const widest = math.max(...gaps);
		const slot = (2 * math.pi) / RING_SLOTS;
		expect(widest).toBeCloseTo(RING_GAP_ANGLE, 6); // one gap of (gap slots + 1) spacings...
		for (const g of gaps) if (g !== widest) expect(g).toBeCloseTo(slot, 6); // ...everything else evenly spaced
		// The gap is centred on v[GAP] and no bullet lies within half the gap of it.
		const gx = a.v[BRUISER_GAP_X];
		const gz = a.v[BRUISER_GAP_Z];
		const gapAngle = math.atan2(gx, gz);
		const i = gaps.indexOf(widest);
		const centre = angles[i] + widest / 2;
		expect(math.abs(wrap(centre - gapAngle))).toBeLessThan(1e-6);
		for (const v of angles) expect(math.abs(wrap(v - gapAngle))).toBeGreaterThan(RING_GAP_ANGLE / 2 - 1e-6);
		// Near the player's bearing (turned ~37 or ~53 degrees), and wide enough to walk through a short way out.
		const toPlayer = math.atan2(s.player.x - a.x, s.player.z - a.z);
		const off = math.abs(wrap(gapAngle - toPlayer));
		expect(off).toBeGreaterThan(0.6);
		expect(off).toBeLessThan(0.95);
		const passableAt = (2 * (PLAYER_RADIUS + ENEMY_BULLET_RADIUS)) / (2 * math.sin(RING_GAP_ANGLE / 2));
		expect(passableAt).toBeLessThan(1);
		// Between any other two neighbours the player does not fit until well out (>= 2.5 units).
		expect((2 * (PLAYER_RADIUS + ENEMY_BULLET_RADIUS)) / (2 * math.sin(slot / 2))).toBeGreaterThan(2.5);
		expect(minR).toBeGreaterThan(BRUISER.data.radius);
	});

	it("slows to a stop after the slam (recover), then chases again", () => {
		const config: SimConfig = { encounter: enc([{ kind: "bruiser", x: 0, z: 2.4 }]) };
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		for (let t = 0; t < 300 && s.combat.enemySpawned === 0; t++) step(s, EMPTY_INPUT, config);
		const x = a.x;
		const z = a.z;
		run(s, BRUISER.data.recoverTicks - 1, config);
		expect([a.x, a.z]).toEqual([x, z]);
		expect(a.aiState).never.toBe(STATE_ENGAGED);
		run(s, 2, config);
		expect(a.aiState).toBe(STATE_ENGAGED);
	});
});

describe("room enemy rules (aggro, alerts, leash)", () => {
	it("a hit packmate alerts the pack; a kill alerts the rest", () => {
		const spawns: ActorSpawn[] = [
			{ kind: "swarmer", x: 0, z: 20 },
			{ kind: "swarmer", x: 1, z: 20 },
			{ kind: "bruiser", x: 2, z: 21 },
			{ kind: "swarmer", x: 0, z: 40 }, // far: stays out of it
		];
		const config: SimConfig = { encounter: enc(spawns) };
		const s = createSimState(1, 0, 0, config);
		const actors = s.combat.actors;
		const [a, b, c, far] = [actors[0], actors[1], actors[2], actors[3]];
		run(s, 10, config);
		expect(s.combat.actors.every((x) => x.v[V_AGGRO] === 0)).toBe(true);
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		ctx.damageActor(c, 1); // the bruiser is shot from out of range
		expect(c.v[V_AGGRO]).toBe(1);
		run(s, 1, config);
		expect([a.v[V_AGGRO], b.v[V_AGGRO]]).toEqual([1, 1]); // alerted by an engaged neighbour
		expect(far.v[V_AGGRO]).toBe(0);

		const config2: SimConfig = { encounter: enc(spawns) };
		const s2 = createSimState(1, 0, 0, config2);
		new SimCtx().bind(s2, config2, EMPTY_INPUT).damageActor(s2.combat.actors[0], 10); // one-shot from afar
		expect(s2.combat.actors[0].alive).toBe(0);
		expect(s2.combat.actors[1].v[V_AGGRO]).toBe(1);
		expect(s2.combat.actors[2].v[V_AGGRO]).toBe(1);
		expect(s2.combat.actors[3].v[V_AGGRO]).toBe(0);
	});

	it("a wall hides the player: no aggro through it", () => {
		const config = wallConfig(
			[
				{ kind: "swarmer", x: 6, z: 0 },
				{ kind: "bruiser", x: 6, z: 1 },
			],
			3,
		);
		const s = createSimState(1, 0, 0, config);
		run(s, 120, config);
		for (const a of s.combat.actors) {
			expect(a.v[V_AGGRO]).toBe(0);
			expect([a.x, a.z]).toEqual([a.v[V_HOME_X], a.v[V_HOME_Z]]);
		}
	});

	it("leashes home when the player dies, and when dragged past leashRange", () => {
		const config: SimConfig = { encounter: enc([{ kind: "swarmer", x: 0, z: 6 }]) };
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		ghost(s);
		run(s, 30, config);
		expect(a.v[V_AGGRO]).toBe(1);
		s.player.dead = 1;
		run(s, 1, config);
		expect(a.aiState).toBe(STATE_RETURN);
		run(s, 240, config);
		expect(a.aiState).toBe(AiState.IDLE);
		expect(dist(a, { x: 0, z: 6 })).toBeLessThan(0.2);

		// Kited far away: past leashRange from home it turns back.
		const c2: SimConfig = { encounter: enc([{ kind: "swarmer", x: 0, z: 6 }]) };
		const k = createSimState(1, 0, 0, c2);
		ghost(k);
		const b = k.combat.actors[0];
		let leashed = false;
		for (let t = 0; t < 600 && !leashed; t++) {
			k.player.z = b.z - 3; // the player keeps 3 units ahead of it, running -z
			k.player.prevZ = k.player.z;
			step(k, EMPTY_INPUT, c2);
			if (b.aiState === STATE_RETURN) leashed = true;
		}
		expect(leashed).toBe(true);
		expect(dist(b, { x: 0, z: 6 })).toBeGreaterThan(SWARMER.data.leashRange);
		expect(dist(b, { x: 0, z: 6 })).toBeLessThan(SWARMER.data.leashRange + 0.5);
	});
});
