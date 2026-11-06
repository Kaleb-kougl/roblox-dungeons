// docs/LEGENDARIES.md LG4 (the legendary duos): Supernova (a carry of SUPERNOVA_CARRY or more bursts one Volatile ring
// larger: I -> 12, II -> 16, III -> 16 that pierce 2, Shrapnel's too; only existing arc rows), Skewer (the streak strikes
// every enemy within SKEWER_RADIUS of the corpse -> target segment for the full carry, slot order, the target last),
// Citadel (no once-per-room limit, still one brace per guard) and Stone Heart (a brace with no pip missing heals half a
// heart, once per room unless Citadel).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILDS_CONFIG,
	Boon,
	BraceKind,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	Duo,
	EMPTY_INPUT,
	SHRAPNEL_DAMAGE,
	SKEWER_RADIUS,
	STONE_HEART_HEAL_HALF_HEARTS,
	SUPERNOVA_CARRY,
	SWORD_DATA,
	SimCtx,
	VOLATILE_DAMAGE,
	createSimState,
	duoCard,
	fireBurstRaw,
	grantCard,
	packPayload,
	step,
	type ActorState,
	type EndlessFloorWorld,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;
const GUARD = frame(0, 0, Button.ALT, 0, 1);

function arena(): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

const ARENA: SimConfig = { endless: { runSeed: SEED, worldForFloor: arena() }, scoring: {}, builds: BUILDS_CONFIG };

function fresh(): SimState {
	return createSimState(SEED, 0, 0, ARENA);
}

function ctxOf(s: SimState): SimCtx {
	return new SimCtx().bind(s, ARENA.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

function dummy(ctx: SimCtx, x: number, z: number, hp = 10): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

function setLevel(s: SimState, boon: number, level: number): void {
	s.builds!.players[0].levels[boon] = level;
}

function hitWith(ctx: SimCtx, a: ActorState, dmg: number): void {
	ctx.actingPlayer(0);
	ctx.damageActor(a, dmg);
}

/** Live player bullets of kind BURST as [damage, pierce]. */
function bolts(s: SimState): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	s.combat.playerBullets.forEachActive((_i, _pos, payload) => {
		if (BulletPayload.get(payload, "kind") === BulletKind.BURST) {
			out.push([BulletPayload.get(payload, "damage"), BulletPayload.get(payload, "pierce")]);
		}
		return false;
	});
	return out;
}

describe("Supernova (Overkill + Volatile, LG4)", () => {
	/** A kill carrying `carry` (a full-hp 1-hp dummy hit for carry + 1) at Volatile `level`; the ring it bursts. */
	function burst(level: number, carry: number, duo = true, shrapnel = false): { fired: number[]; s: SimState } {
		const s = fresh();
		setLevel(s, Boon.OVERKILL, 1);
		setLevel(s, Boon.VOLATILE, level);
		if (duo) s.builds!.players[0].duos.push(Duo.SUPERNOVA);
		if (shrapnel) {
			setLevel(s, Boon.SHARPENED, 1);
			s.builds!.players[0].duos.push(Duo.SHRAPNEL);
		}
		const ctx = ctxOf(s);
		hitWith(ctx, dummy(ctx, 0, 6, 1), carry + 1);
		step(s, IDLE, ARENA);
		return { fired: [...s.builds!.events.burstFired], s };
	}

	it("a carry of SUPERNOVA_CARRY (3) or more bursts one ring larger: I 12, II 16, III 16 piercing 2", () => {
		expect(SUPERNOVA_CARRY).toBe(3);
		expect([burst(1, 3).fired, burst(2, 3).fired, burst(3, 5).fired]).toEqual([[12], [16], [16]]);
		const two = burst(2, 3).s;
		expect(bolts(two).every(([d, p]) => d === VOLATILE_DAMAGE && p === 0)).toBe(true);
		const three = burst(3, 3).s;
		expect(bolts(three).size()).toBe(16);
		expect(bolts(three).every(([, p]) => p === 2)).toBe(true);
		const e = three.builds!.events;
		expect([e.duoProcDuo, e.duoProcValue]).toEqual([[Duo.SUPERNOVA], [16]]);
	});

	it("a smaller carry, or no duo, bursts the ordinary ring (8 / 12 / 16 piercing 1)", () => {
		expect([burst(1, 2).fired, burst(2, 2).fired, burst(1, 5, false).fired]).toEqual([[8], [12], [8]]);
		const three = burst(3, 2).s;
		expect(bolts(three).every(([, p]) => p === 1)).toBe(true);
		expect(three.builds!.events.duoProcDuo).toEqual([]);
	});

	it("with Shrapnel: the larger ring keeps Shrapnel's damage and pierce (I 12 piercing 1)", () => {
		const r = burst(1, 4, true, true);
		expect(r.fired).toEqual([12]);
		expect(bolts(r.s).every(([d, p]) => d === SHRAPNEL_DAMAGE && p === 1)).toBe(true);
		expect(burst(2, 4, true, true).fired).toEqual([16]);
		expect(burst(3, 4, true, true).fired).toEqual([16]);
	});
});

describe("Skewer (Overkill + Piercing Arrows, LG4)", () => {
	it("the streak strikes every enemy within SKEWER_RADIUS of the corpse -> target line, slot order, the target last", () => {
		const s = fresh();
		setLevel(s, Boon.OVERKILL, 1);
		s.builds!.players[0].duos.push(Duo.SKEWER);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 0, 1);
		// The nearest (the target) at 3 straight ahead; two more on the line's end within the radius (farther than
		// the target), spawned before and after it; one just off the line; one behind the corpse beyond the radius.
		const beyond = dummy(ctx, 0.3, 3.2, 1);
		const target = dummy(ctx, 0, 3, 1);
		const beside = dummy(ctx, -0.25, 3.3, 1);
		const off = dummy(ctx, 0.6, 3.6, 1);
		const behind = dummy(ctx, 0, -3.3, 1);
		expect(SKEWER_RADIUS).toBe(0.5);
		hitWith(ctx, victim, 6);
		step(s, IDLE, ARENA);
		expect([beyond.alive, target.alive, beside.alive, off.alive, behind.alive]).toEqual([0, 0, 0, 1, 1]);
		// Each kill queued its proc in strike order: slot order along the line, then the target.
		expect(s.builds!.procs.map((q) => q.id)).toEqual([beyond.id, beside.id, target.id]);
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([4, 4, 4]);
		const e = s.builds!.events;
		expect([e.overkillX2, e.overkillZ2, e.overkillCarry]).toEqual([[0], [3], [5]]);
		expect([e.duoProcDuo, e.duoProcValue]).toEqual([[Duo.SKEWER], [3]]);
	});

	it("without the duo only the target is struck", () => {
		const s = fresh();
		setLevel(s, Boon.OVERKILL, 1);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 0, 1);
		const beyond = dummy(ctx, 0.3, 3.2, 1);
		const target = dummy(ctx, 0, 3, 1);
		hitWith(ctx, victim, 6);
		step(s, IDLE, ARENA);
		expect([beyond.alive, target.alive, s.builds!.events.duoProcDuo.size()]).toEqual([1, 0, 0]);
	});
});

describe("Citadel and Stone Heart (Bastion duos, LG4)", () => {
	function volley(s: SimState, n = 3): void {
		const c = s.combat;
		for (let k = 0; k < n; k++) {
			const x = -0.4 + 0.4 * (k % 3);
			const z = 1.2 + 0.2 * math.floor(k / 3);
			c.enemySpawned += fireBurstRaw(
				c.enemyBullets,
				1,
				x,
				z,
				0,
				1,
				1,
				0,
				0,
				3,
				packPayload(1, BulletKind.ENEMY, 1),
			);
		}
	}

	function bastionWith(boon: number, duo: number): SimState {
		const s = fresh();
		grantCard(s, 0, Boon.BASTION);
		grantCard(s, 0, boon);
		expect(grantCard(s, 0, duoCard(duo))).toBeGreaterThanOrEqual(0);
		return s;
	}

	function guardOnce(s: SimState, n = 3): void {
		volley(s, n);
		step(s, GUARD, ARENA);
		for (let t = 0; t < SWORD_DATA.guardCooldownTicks; t++) step(s, IDLE, ARENA);
	}

	it("Citadel: every guard that stops 3 restores a pip (no once per room), still one brace per guard", () => {
		const s = bastionWith(Boon.WARDING, Duo.CITADEL);
		const p = s.player;
		p.armor = 0;
		guardOnce(s, 6);
		expect(p.armor).toBe(1); // 6 bullets, one brace
		p.armor = 0;
		guardOnce(s);
		expect(p.armor).toBe(1); // the same room: Citadel braces again
	});

	it("Stone Heart: a brace at full armor heals half a heart (BraceKind.HEAL), once per room", () => {
		const s = bastionWith(Boon.HEARTY, Duo.STONE_HEART);
		const p = s.player;
		p.hearts = p.heartsMax - 2;
		volley(s);
		step(s, GUARD, ARENA);
		expect(STONE_HEART_HEAL_HALF_HEARTS).toBe(1);
		expect([p.hearts, p.armor, p.armorMax]).toEqual([p.heartsMax - 1, p.armorMax, p.armorMax]);
		expect(s.builds!.events.braceKind).toEqual([BraceKind.HEAL]);
		for (let t = 0; t < SWORD_DATA.guardCooldownTicks; t++) step(s, IDLE, ARENA);
		guardOnce(s);
		expect(p.hearts).toBe(p.heartsMax - 1);
	});

	it("Stone Heart heals only at full armor: a missing pip comes back instead", () => {
		const s = bastionWith(Boon.HEARTY, Duo.STONE_HEART);
		const p = s.player;
		p.hearts = p.heartsMax - 2;
		p.armor = 0;
		volley(s);
		step(s, GUARD, ARENA);
		expect([p.hearts, p.armor]).toEqual([p.heartsMax - 2, 1]);
		expect(s.builds!.events.braceKind).toEqual([BraceKind.PIP]);
	});

	it("Stone Heart with full hearts and armor: the brace is spent", () => {
		const s = bastionWith(Boon.HEARTY, Duo.STONE_HEART);
		volley(s);
		step(s, GUARD, ARENA);
		expect(s.builds!.events.braceKind).toEqual([BraceKind.SPENT]);
		expect(s.builds!.players[0].braceReady).toBe(0);
	});

	it("Stone Heart + Citadel: the heal is no longer once per room", () => {
		const s = fresh();
		grantCard(s, 0, Boon.BASTION);
		grantCard(s, 0, Boon.HEARTY);
		grantCard(s, 0, Boon.WARDING);
		grantCard(s, 0, duoCard(Duo.STONE_HEART));
		grantCard(s, 0, duoCard(Duo.CITADEL));
		const p = s.player;
		p.hearts = p.heartsMax - 2;
		guardOnce(s);
		guardOnce(s);
		expect(p.hearts).toBe(p.heartsMax);
	});
});
