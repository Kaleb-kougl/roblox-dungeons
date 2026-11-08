// docs/BUILDS_V2.md BV2 (Riposte and Counterstrike) and BV6's guard-side duos (Thunder Guard, Stillwater, Rebuke): the
// count (cancels, goo never), the counter-wave of a guard that ran its full length (a forward crescent for the capped
// count, x Sharpened, nothing behind; the cap 6 / 10; each enemy once), a roll-cut, a swapped and a floor-crossing
// guard firing nothing, Counterstrike's ring and returns (5 erased; 4: the crescent only), a full effect budget dropping
// returns and never the wave, wave kills procing at gen 0; Thunder Guard's sparks from the erased bullets (at most 8 a
// tick), Stillwater's restore (within 3 s, not after, once), Rebuke's ring (a bow roll's brace that restores a pip; none
// with nothing to restore or on a second brace in the room; it replaces the guard's forward wave; a braced guard cut by
// a roll fires nothing); determinism in a dense co-op room.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BASTION_BRACE_BULLETS,
	BUILDS_CONFIG,
	Boon,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	COMBO_MIN,
	COUNTERSTRIKE_RING_ERASED,
	COUNTERSTRIKE_RING_HALF_ANGLE_COS,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	Duo,
	RIPOSTE_MAX_COUNT,
	RIPOSTE_WAVE_HALF_ANGLE_COS,
	RIPOSTE_WAVE_RANGE,
	RIPOSTE_WAVE_SPEED,
	RIPOSTE_WAVES_MAX,
	STILLWATER_TICKS,
	STILL_NONE,
	SWORD_DATA,
	SWORD_V_GUARD,
	SimCtx,
	SparkFork,
	THUNDER_GUARD_MAX,
	WaveKind,
	buildSource,
	createSimState,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	playerAt,
	playerHitDamage,
	spawnWave,
	step,
	stepParty,
	weaponsAt,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
/** Every frame aims along +Z (the knight faces +Z). */
const IDLE = frame(0, 0, 0, 0, 1);
const GUARD = frame(0, 0, Button.ALT, 0, 1);
const ROLL = frame(0, 0, Button.ROLL, 0, 1);
const SWAP = frame(0, 0, Button.SWAP, 0, 1);

function arena(loadout?: ReadonlyArray<string>): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					loadout,
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

function configOf(loadout?: ReadonlyArray<string>, extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena(loadout) }, scoring: {}, builds: BUILDS_CONFIG, ...extra };
}

const ARENA = configOf();
const BOW_ARENA = configOf(["weapon.bow"]);
const PARTY2 = configOf(undefined, { scoring: { partySize: 2 }, party: { size: 2 } });

/** A fresh run whose players own Riposte at `level` (0: none). */
function fresh(config: SimConfig = ARENA, level = 1): SimState {
	const s = createSimState(SEED, 0, 0, config);
	for (let i = 0; i < (config.party?.size ?? 1); i++) for (let k = 0; k < level; k++) grantCard(s, i, Boon.RIPOSTE);
	// Face +Z.
	if (config.party !== undefined) stepParty(s, [IDLE, IDLE], config);
	else step(s, IDLE, config);
	return s;
}

function ctxOf(s: SimState, config: SimConfig = ARENA): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, IDLE);
}

/** A stationary test.dummy (radius 0.5) at (x, z) with `hp`. */
function dummy(s: SimState, x: number, z: number, hp = 50, config: SimConfig = ARENA): ActorState {
	const a = ctxOf(s, config).spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** A stationary enemy bullet at (x, z). */
function enemyBullet(s: SimState, x: number, z: number, kind: number = BulletKind.ENEMY): void {
	const c = s.combat;
	c.enemySpawned += fireBurstRaw(c.enemyBullets, 1, x, z, 0, 1, 1, 0, 0, 3, packPayload(1, kind, 1));
}

/** `n` stationary bullets in front of the knight (at its position, facing +Z), 4 a row from 0.9 ahead by 0.2. */
function volleyInFront(s: SimState, n: number, from = 0, i = 0): void {
	const p = playerAt(s, i);
	for (let k = from; k < from + n; k++)
		enemyBullet(s, p.x - 0.6 + 0.4 * (k % 4), p.z + 0.9 + 0.2 * math.floor(k / 4));
}

function bp(s: SimState, i = 0) {
	return s.builds!.players[i];
}

interface WaveLog {
	kind: number[];
	damage: number[];
	halfCos: number[];
	count: number[];
	tick: number[];
}

/** Steps `n` idle ticks (solo), collecting the spawned waves. */
function run(s: SimState, n: number, log?: WaveLog, config: SimConfig = ARENA, input: InputFrame = IDLE): WaveLog {
	const out = log ?? { kind: [], damage: [], halfCos: [], count: [], tick: [] };
	for (let t = 0; t < n; t++) {
		step(s, input, config);
		const e = s.builds!.events;
		for (let k = 0; k < e.waveKind.size(); k++) {
			out.kind.push(e.waveKind[k]);
			out.damage.push(e.waveDamage[k]);
			out.halfCos.push(e.waveHalfCos[k]);
			out.count.push(e.counterCount[k]);
			out.tick.push(s.tick - 1);
		}
	}
	return out;
}

/** A guard (the ALT press) erasing `n` bullets on its first tick, then `after` idle ticks; the waves it sent. */
function guardOf(s: SimState, n: number, after = 40, config: SimConfig = ARENA): WaveLog {
	volleyInFront(s, n);
	const log = run(s, 1, undefined, config, GUARD);
	return run(s, after, log, config);
}

/** Live player bullets of kind SHARD whose source is Counterstrike's (BuildEffect.RIPOSTE, gen 0). */
function returns(s: SimState): number {
	const source = buildSource(BuildEffect.RIPOSTE, 0);
	let n = 0;
	s.combat.playerBullets.forEachActive((_i, _pos, payload) => {
		if (
			BulletPayload.get(payload, "kind") === BulletKind.SHARD &&
			BulletPayload.get(payload, "source") === source
		) {
			n++;
		}
		return false;
	});
	return n;
}

describe("Riposte: the counter-wave (BV2)", () => {
	it("a guard that erases 4 sends a forward wave dealing 4 (x Sharpened) to an enemy 6 tiles ahead, none behind", () => {
		for (const sharpened of [false, true]) {
			const s = fresh();
			if (sharpened) grantCard(s, 0, Boon.SHARPENED);
			const ahead = dummy(s, 0, 6);
			const behind = dummy(s, 0, -3);
			const log = guardOf(s, 4);
			expect(log.kind).toEqual([WaveKind.FORWARD]);
			expect([log.damage, log.count, log.halfCos]).toEqual([[4], [4], [RIPOSTE_WAVE_HALF_ANGLE_COS]]);
			// The wave goes out on the guard's last tick (an 18-tick guard: pressed on tick 1, ends on tick 18).
			expect(log.tick[0]).toBe(1 + SWORD_DATA.guardTicks - 1);
			const dealt = playerHitDamage(s, 0, 4);
			expect(dealt).toBe(sharpened ? 5 : 4);
			expect([ahead.hp, behind.hp]).toEqual([50 - dealt, 50]);
			expect([s.builds!.waves.size(), bp(s).riposteCount]).toEqual([0, 0]);
		}
	});

	it("the wave grows at 24 tiles / s to 7 tiles and is gone after the tick it reached its range", () => {
		const s = fresh();
		volleyInFront(s, 1);
		run(s, 1, undefined, ARENA, GUARD);
		run(s, SWORD_DATA.guardTicks - 2);
		expect(s.builds!.waves.size()).toBe(0);
		run(s, 1);
		const w = s.builds!.waves;
		expect(w.size()).toBe(1);
		expect([w[0].radius, w[0].range, w[0].speed]).toEqual([
			RIPOSTE_WAVE_SPEED / 60,
			RIPOSTE_WAVE_RANGE,
			RIPOSTE_WAVE_SPEED,
		]);
		let ticks = 1;
		while (s.builds!.waves.size() > 0) {
			run(s, 1);
			ticks++;
		}
		expect(ticks).toBe(18); // 7 / 0.4 = 17.5: the 18th tick caps the radius at the range
	});

	it("0 erased sends nothing; goo erased by the guard never counts", () => {
		const s = fresh();
		dummy(s, 0, 3);
		expect(guardOf(s, 0).kind).toEqual([]);
		const g = fresh();
		dummy(g, 0, 3);
		enemyBullet(g, 0, 1.1, BulletKind.GOO);
		enemyBullet(g, 0.4, 1.1, BulletKind.GOO);
		const log = run(g, 1, undefined, ARENA, GUARD);
		expect(bp(g).riposteCount).toBe(0);
		expect(run(g, 40, log).kind).toEqual([]);
	});

	it("the cap: 12 erased deal 6 at level I, 10 at level II and III", () => {
		const out: number[] = [];
		for (const level of [1, 2]) {
			const s = fresh(ARENA, level);
			const a = dummy(s, 0, 4, 100);
			const log = guardOf(s, 12);
			expect(log.count).toEqual([12]);
			out.push(log.damage[0], 100 - a.hp);
		}
		expect(out).toEqual([6, 6, 10, 10]);
		expect(RIPOSTE_MAX_COUNT).toEqual([6, 10, 10]);
	});

	it("a wave hits an enemy once however long it stays in the band (a body on the origin, one beside it)", () => {
		const s = fresh();
		const on = dummy(s, 0, 0.2);
		const near = dummy(s, 0.3, 2);
		const log = guardOf(s, 3);
		expect(log.damage).toEqual([3]);
		expect([on.hp, near.hp]).toEqual([47, 47]);
	});

	it("a roll-cut guard and a swapped guard fire nothing", () => {
		const r = fresh();
		dummy(r, 0, 3);
		volleyInFront(r, 4);
		let log = run(r, 1, undefined, ARENA, GUARD);
		expect(bp(r).riposteCount).toBe(4);
		log = run(r, 1, log, ARENA, ROLL);
		expect(bp(r).riposteCount).toBe(0);
		expect(weaponsAt(r, 0).sets[0].v[SWORD_V_GUARD]).toBe(0);
		expect(run(r, 60, log).kind).toEqual([]);

		const w = fresh();
		dummy(w, 0, 3);
		volleyInFront(w, 4);
		log = run(w, 1, undefined, ARENA, GUARD);
		log = run(w, 1, log, ARENA, SWAP);
		expect([bp(w).riposteCount, weaponsAt(w, 0).activeSet]).toEqual([0, 1]);
		log = run(w, 30, log);
		log = run(w, 1, log, ARENA, SWAP); // back in: the frozen guard is zeroed, no end
		expect(weaponsAt(w, 0).sets[0].v[SWORD_V_GUARD]).toBe(0);
		expect(run(w, 40, log).kind).toEqual([]);
	});

	it("a guard running across the floor change fires nothing for the old floor's bullets", () => {
		const s = fresh();
		volleyInFront(s, 4);
		let log = run(s, 1, undefined, ARENA, GUARD);
		log = run(s, 1, log, ARENA, frame(0, 0, DEBUG_FLOOR_BUTTON, 0, 1));
		expect(s.events.floorChanged).toBe(2);
		expect([bp(s).riposteCount, weaponsAt(s, 0).sets[0].v[SWORD_V_GUARD] > 0]).toEqual([0, true]);
		dummy(s, playerAt(s, 0).x, playerAt(s, 0).z + 3);
		expect(run(s, 40, log).kind).toEqual([]);
	});

	it("wave kills proc at gen 0 (Chain Spark hops from the corpse at the proc's generation 0)", () => {
		const s = fresh();
		grantCard(s, 0, Boon.CHAIN_SPARK);
		const victim = dummy(s, 0, 3, 2);
		dummy(s, 2, 3);
		volleyInFront(s, 4);
		run(s, 1, undefined, ARENA, GUARD);
		let sparks: number[] = [];
		for (let t = 0; t < 40 && victim.alive !== 0; t++) {
			run(s, 1);
			sparks = [...s.builds!.events.sparkGen];
		}
		expect(victim.alive).toBe(0);
		expect(sparks).toEqual([0]);
	});

	it("at most RIPOSTE_WAVES_MAX waves live; one more is not spawned", () => {
		const s = fresh();
		for (let k = 0; k < RIPOSTE_WAVES_MAX; k++) {
			expect(spawnWave(s.builds!, 0, 0, 0, 0, 1, RIPOSTE_WAVE_HALF_ANGLE_COS, 1, WaveKind.FORWARD, 1)).toBe(true);
		}
		expect(spawnWave(s.builds!, 0, 0, 0, 0, 1, RIPOSTE_WAVE_HALF_ANGLE_COS, 1, WaveKind.FORWARD, 1)).toBe(false);
		expect([s.builds!.waves.size(), s.builds!.events.waveKind.size()]).toEqual([
			RIPOSTE_WAVES_MAX,
			RIPOSTE_WAVES_MAX,
		]);
	});
});

describe("Counterstrike (Riposte III, BV2)", () => {
	it("5 erased: a full ring (the enemy behind is struck) and 5 returns; 4: the forward wave, no returns", () => {
		for (const n of [COUNTERSTRIKE_RING_ERASED, COUNTERSTRIKE_RING_ERASED - 1]) {
			const s = fresh(ARENA, 3);
			const behind = dummy(s, 0, -3);
			dummy(s, 3, 0);
			volleyInFront(s, n);
			let log = run(s, 1, undefined, ARENA, GUARD);
			log = run(s, SWORD_DATA.guardTicks - 1, log);
			const ring = n >= COUNTERSTRIKE_RING_ERASED;
			expect(log.kind).toEqual([ring ? WaveKind.RING : WaveKind.FORWARD]);
			expect(log.halfCos).toEqual([ring ? COUNTERSTRIKE_RING_HALF_ANGLE_COS : RIPOSTE_WAVE_HALF_ANGLE_COS]);
			expect(returns(s)).toBe(ring ? n : 0);
			run(s, 20, log);
			expect(behind.hp < 50).toBe(ring);
		}
	});

	it("a full effect budget drops the returns, never the wave", () => {
		const s = fresh(ARENA, 3);
		const behind = dummy(s, 0, -3, 100);
		// The owner's whole effect budget (effectBulletsMax shards) parked far away.
		const c = s.combat;
		const emitter = weaponsAt(s, 0).emitterId;
		const payload = packPayload(1, BulletKind.SHARD, buildSource(BuildEffect.SOUL_SHARDS, 0));
		for (let k = 0; k < BUILDS_CONFIG.effectBulletsMax; k++) {
			c.playerSpawned += fireBurstRaw(c.playerBullets, emitter, 6, -6, 0, 1, 1, 0, 0, 99, payload);
		}
		volleyInFront(s, 6);
		let log = run(s, 1, undefined, ARENA, GUARD);
		log = run(s, SWORD_DATA.guardTicks - 1, log);
		expect(log.kind).toEqual([WaveKind.RING]);
		expect(returns(s)).toBe(0);
		expect(s.builds!.events.effectDropped).toBe(6);
		run(s, 20, log);
		expect(behind.hp).toBe(100 - 6);
	});
});

describe("Thunder Guard (Riposte + Chain Spark, BV6)", () => {
	it("each erased bullet sparks from where it was to the nearest enemy, at most THUNDER_GUARD_MAX a tick", () => {
		const s = fresh();
		grantCard(s, 0, Boon.CHAIN_SPARK);
		s.builds!.players[0].duos.push(Duo.THUNDER_GUARD);
		const a = dummy(s, 0, 3, 100);
		volleyInFront(s, 10);
		step(s, GUARD, ARENA);
		const e = s.builds!.events;
		const g = s.score!.events;
		expect(g.guardX.size()).toBe(10);
		const xs: number[] = [];
		const zs: number[] = [];
		for (let k = 0; k < e.sparkFork.size(); k++) {
			if (e.sparkFork[k] !== SparkFork.THUNDER) continue;
			xs.push(e.sparkX1[k]);
			zs.push(e.sparkZ1[k]);
		}
		const wantX: number[] = [];
		const wantZ: number[] = [];
		for (let k = 0; k < THUNDER_GUARD_MAX; k++) {
			wantX.push(g.guardX[k]);
			wantZ.push(g.guardZ[k]);
		}
		expect(THUNDER_GUARD_MAX).toBe(8);
		expect([xs, zs]).toEqual([wantX, wantZ]);
		expect(e.sparkX2.every((x) => x === a.x)).toBe(true);
		expect(a.hp).toBe(100 - THUNDER_GUARD_MAX);
	});

	it("without the duo the guard sparks nothing", () => {
		const s = fresh();
		grantCard(s, 0, Boon.CHAIN_SPARK);
		const a = dummy(s, 0, 3, 100);
		volleyInFront(s, 4);
		step(s, GUARD, ARENA);
		expect([s.builds!.events.sparkFork.size(), a.hp]).toEqual([0, 100]);
	});
});

describe("Stillwater (Composure + Riposte, BV6)", () => {
	function owner(): SimState {
		const s = fresh();
		grantCard(s, 0, Boon.COMPOSURE);
		s.builds!.players[0].duos.push(Duo.STILLWATER);
		return s;
	}

	/** A hit on the knight at x3.0 (no i-frames): the cut. */
	function cut(s: SimState): void {
		s.score!.combo = 30;
		s.score!.comboTimer = 1000;
		s.player.iframeTicks = 0;
		enemyBullet(s, s.player.x, s.player.z);
		step(s, IDLE, ARENA);
	}

	it("a hit's cut is recorded; an erasing guard within 3 s gives it back, once", () => {
		const s = owner();
		cut(s);
		const b = s.builds!;
		expect([b.stillCombo, b.stillTick]).toEqual([30, s.tick - 1]);
		expect(s.score!.combo < 30).toBe(true);
		run(s, STILLWATER_TICKS - 2);
		volleyInFront(s, 1);
		step(s, GUARD, ARENA);
		expect([s.score!.combo, b.stillTick]).toEqual([30, STILL_NONE]);
		// Once: the next erasing guard gives nothing back.
		run(s, SWORD_DATA.guardCooldownTicks);
		s.score!.combo = 12;
		volleyInFront(s, 1);
		step(s, GUARD, ARENA);
		expect(s.score!.combo).toBe(12);
	});

	it("not after 3 s; not without an erased bullet; nothing recorded without the duo or at x1.0", () => {
		const late = owner();
		cut(late);
		late.score!.comboTimer = 1000;
		run(late, STILLWATER_TICKS + 1);
		const before = late.score!.combo;
		volleyInFront(late, 1);
		step(late, GUARD, ARENA);
		expect([late.score!.combo, late.builds!.stillTick]).toEqual([before, STILL_NONE]);

		const empty = owner();
		cut(empty);
		step(empty, GUARD, ARENA);
		expect(empty.builds!.stillTick).never.toBe(STILL_NONE);

		const none = fresh();
		cut(none);
		expect(none.builds!.stillTick).toBe(STILL_NONE);
		const flat = owner();
		flat.player.iframeTicks = 0;
		enemyBullet(flat, flat.player.x, flat.player.z);
		step(flat, IDLE, ARENA);
		expect([flat.score!.combo, flat.builds!.stillTick]).toEqual([COMBO_MIN, STILL_NONE]);
	});
});

describe("Rebuke (Bastion + Riposte, BV6)", () => {
	function owner(config: SimConfig = ARENA, duo = true): SimState {
		const s = fresh(config);
		grantCard(s, 0, Boon.BASTION);
		if (duo) s.builds!.players[0].duos.push(Duo.REBUKE);
		return s;
	}

	function rollInPlace(s: SimState, config: SimConfig): WaveLog {
		const log = run(s, 1, undefined, config, ROLL);
		s.player.rollDirX = 0;
		s.player.rollDirZ = 0;
		return log;
	}

	it("a bow roll through 8 bullets that restores a pip fires a full ring at once", () => {
		const s = owner(BOW_ARENA);
		s.player.armor = 0;
		const behind = dummy(s, 0, -3, 50, BOW_ARENA);
		let log = rollInPlace(s, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(s, s.player.x, s.player.z);
		log = run(s, 1, log, BOW_ARENA);
		expect(s.player.armor).toBe(1);
		expect([log.kind, log.halfCos, log.damage, log.count]).toEqual([
			[WaveKind.REBUKE],
			[COUNTERSTRIKE_RING_HALF_ANGLE_COS],
			[RIPOSTE_MAX_COUNT[0]],
			[BASTION_BRACE_BULLETS],
		]);
		run(s, 20, log, BOW_ARENA);
		expect(behind.hp).toBe(50 - RIPOSTE_MAX_COUNT[0]);
	});

	it("none when no pip is missing (no Stone Heart), none on a second brace in the room, none without the duo", () => {
		const full = owner(BOW_ARENA);
		let log = rollInPlace(full, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(full, full.player.x, full.player.z);
		expect(run(full, 30, log, BOW_ARENA).kind).toEqual([]);

		const twice = owner(BOW_ARENA);
		twice.player.armor = 0;
		log = rollInPlace(twice, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(twice, twice.player.x, twice.player.z);
		log = run(twice, 40, log, BOW_ARENA);
		expect(log.kind).toEqual([WaveKind.REBUKE]);
		twice.player.armor = 0;
		const second = rollInPlace(twice, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(twice, twice.player.x, twice.player.z);
		expect(run(twice, 30, second, BOW_ARENA).kind).toEqual([]);

		const plain = owner(BOW_ARENA, false);
		plain.player.armor = 0;
		log = rollInPlace(plain, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(plain, plain.player.x, plain.player.z);
		log = run(plain, 1, log, BOW_ARENA);
		expect(plain.player.armor).toBe(1);
		expect(run(plain, 30, log, BOW_ARENA).kind).toEqual([]);
	});

	it("a guard that braces fires the ring at its full-length end instead of (not beside) the forward wave", () => {
		for (const duo of [true, false]) {
			const s = owner(ARENA, duo);
			s.player.armor = 0;
			const behind = dummy(s, 0, -3);
			const log = guardOf(s, BASTION_BRACE_BULLETS);
			expect(s.player.armor).toBe(1);
			expect(log.kind).toEqual([duo ? WaveKind.REBUKE : WaveKind.FORWARD]);
			expect(log.damage).toEqual([RIPOSTE_MAX_COUNT[0]]);
			expect(behind.hp).toBe(duo ? 50 - RIPOSTE_MAX_COUNT[0] : 50);
		}
	});

	it("a guard that braced and is then cut by a roll fires nothing", () => {
		const s = owner();
		s.player.armor = 0;
		volleyInFront(s, BASTION_BRACE_BULLETS);
		let log = run(s, 1, undefined, ARENA, GUARD);
		expect([s.player.armor, bp(s).rebukePending]).toEqual([1, 1]);
		log = run(s, 1, log, ARENA, ROLL);
		expect(run(s, 40, log).kind).toEqual([]);
	});
});

describe("Riposte determinism (BV2 / BV6)", () => {
	it("a dense co-op room with Counterstrike and all three duos: two runs hash the same every tick", () => {
		function once(): { hashes: string[]; waves: number; kills: number } {
			const s = fresh(PARTY2, 3);
			for (let i = 0; i < 2; i++) {
				grantCard(s, i, Boon.CHAIN_SPARK);
				grantCard(s, i, Boon.COMPOSURE);
				grantCard(s, i, Boon.BASTION);
				const p = bp(s, i);
				p.duos.push(Duo.THUNDER_GUARD, Duo.STILLWATER, Duo.REBUKE);
			}
			playerAt(s, 1).x = 2;
			const ctx = ctxOf(s, PARTY2);
			for (let k = 0; k < 12; k++) {
				const a = ctx.spawnActor("test.chaser", -5 + k, 6 + (k % 3))!;
				a.spawnTick = -1;
			}
			const hashes: string[] = [];
			let waves = 0;
			let kills = 0;
			for (let t = 0; t < 240; t++) {
				const phase = t % 62;
				if (phase === 0) for (let i = 0; i < 2; i++) volleyInFront(s, 6, 0, i);
				const a: InputFrame = phase === 0 ? GUARD : t % 97 === 50 ? ROLL : IDLE;
				const b: InputFrame = phase === 1 ? GUARD : IDLE;
				stepParty(s, [a, b], PARTY2);
				hashes.push(hashState(s));
				waves += s.builds!.events.waveKind.size();
				kills += s.events.enemiesKilled;
			}
			return { hashes, waves, kills };
		}
		const x = once();
		const y = once();
		expect(x.waves).toBeGreaterThan(0);
		expect([x.waves, x.kills]).toEqual([y.waves, y.kills]);
		expect(x.hashes).toEqual(y.hashes);
	});
});
