// docs/NEW_ENEMIES_2.md NX1 skeleton: band 6 for the third set of room enemies and the Pyre-keeper's brazier (indices
// 19-23; every older index unchanged), their data blocks and rows (the plan's Design tables), BulletKind.HOOK (13, no
// rules yet: the enemy bullet's radius), the room pool rows (appended at NX6), and that every kind spawns, engages
// (the four room enemies; the brazier stands) and replays bit for bit without a draw.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENCOUNTER_COST, ENDLESS_ROOM_KINDS, encounterCost, roomKindMinFloor } from "shared/dungeon";
import {
	BULLET_KIND_COUNT,
	BULWARK,
	BULWARK_DIR_X,
	BULWARK_DIR_Z,
	BULWARK_GUARDING,
	BulletKind,
	CHAINHOOK,
	CHAINHOOK_DIR_X,
	CHAINHOOK_DIR_Z,
	DEFAULT_SIM_CONFIG,
	DROPS,
	DROP_INELIGIBLE_ARCHETYPES,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	IMP,
	KILL_POINTS,
	PELLET_PICKUP_RADIUS,
	PORT_BAND_ENEMIES_3,
	PORT_BAND_FORTUNE,
	PYRE,
	PYREKEEPER,
	PYREKEEPER_LANDING_OFFSETS,
	PYREKEEPER_LAND_X,
	PYREKEEPER_LAND_Z,
	SIM_DT,
	SNATCHER,
	SimCtx,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	enemyBulletHitRadius,
	hashState,
	spawnActor,
	step,
	type ActorState,
	type ArchetypeDef,
	type SimConfig,
	type SimState,
} from "shared/sim";

/** compareIds order: the prefix `pyre` sorts before `pyrekeeper`. */
const NEW_IDS = ["bulwark", "chainhook", "pyre", "pyrekeeper", "snatcher"];
const FIRST = 19;
const DEFS: ReadonlyArray<ArchetypeDef> = [
	BULWARK as unknown as ArchetypeDef,
	CHAINHOOK as unknown as ArchetypeDef,
	PYRE as unknown as ArchetypeDef,
	PYREKEEPER as unknown as ArchetypeDef,
	SNATCHER as unknown as ArchetypeDef,
];
/** The four room enemies (the brazier is a runtime child, not a room enemy). */
const ROOM_IDS = ["bulwark", "chainhook", "snatcher", "pyrekeeper"];

interface World {
	s: SimState;
	ctx: SimCtx;
	config: SimConfig;
}

function world(): World {
	const config: SimConfig = { ...DEFAULT_SIM_CONFIG };
	const s = createSimState(7, 0, 0, config);
	const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
	return { s, ctx, config };
}

function spawn(w: World, id: string, x: number, z: number): ActorState {
	w.ctx.bind(w.s, w.config, EMPTY_INPUT);
	const a = spawnActor(w.ctx, archetypeIndex(id), x, z);
	if (a === undefined) error("spawn failed", 0);
	return a;
}

describe("registry: PORT_BAND_ENEMIES_3 (NXD1)", () => {
	it("is band 6; bulwark, chainhook, pyre, pyrekeeper, snatcher take indices 19-23", () => {
		expect([PORT_BAND_FORTUNE, PORT_BAND_ENEMIES_3]).toEqual([5, 6]);
		for (let k = 0; k < NEW_IDS.size(); k++) {
			const id = NEW_IDS[k];
			expect([id, archetypeIndex(id), archetypeAt(FIRST + k).band]).toEqual([id, FIRST + k, PORT_BAND_ENEMIES_3]);
			expect(DEFS[k].id).toBe(id);
		}
	});

	it("every older index is unchanged (0..18)", () => {
		const ids = archetypeIds();
		const head: string[] = [];
		for (let i = 0; i < FIRST; i++) head.push(ids[i]);
		expect(head).toEqual([
			"boss.act1",
			"bruiser",
			"sniper",
			"swarmer",
			"turret.caster",
			"turret.sniper",
			"turret.sprayer",
			"dummy",
			"boss.demonlord",
			"imp",
			"slime",
			"slime.small",
			"summoner",
			"bomber",
			"charger",
			"reaper",
			"stormcaller",
			"warbanner",
			"golden",
		]);
		expect(ids.size()).toBe(FIRST + NEW_IDS.size());
	});
});

describe("data blocks (the plan's Design tables)", () => {
	it("bodies: hp, radius, speed, contact damage, sprite id; the four are room enemies, the brazier is not", () => {
		const bodies = DEFS.map((d) => [d.id, d.data.hp, d.data.radius, d.data.speed, d.data.contactDamage]);
		expect(bodies).toEqual([
			["bulwark", 10, 0.45, 2, 0],
			["chainhook", 9, 0.45, 2.2, 0],
			["pyre", 4, 0.4, 0, 0],
			["pyrekeeper", 6, 0.35, 2.4, 0],
			["snatcher", 3, 0.3, 5, 0],
		]);
		for (const d of DEFS) {
			expect([d.id, d.data.spriteId]).toEqual([d.id, `enemy.${d.id}`]);
			const room = (d.data as unknown as { roomEnemy?: boolean }).roomEnemy === true;
			expect([d.id, room]).toEqual([d.id, d.id !== PYRE.id]);
		}
	});

	it("Bulwark: keep range, the turn literal (2.5 degrees), the front cone, cover, stagger, bash", () => {
		const b = BULWARK.data;
		expect([b.keepMin, b.keepMax, b.frontCos, b.coverRadius, b.staggerTicks]).toEqual([2, 3, 0.34, 1, 90]);
		// cos^2 + sin^2 = 1 to the last bits, and the angle is 2.5 degrees (150 per second at 60 Hz)
		expect(math.abs(b.turnCos * b.turnCos + b.turnSin * b.turnSin - 1) < 1e-15).toBe(true);
		expect(math.abs(math.deg(math.atan2(b.turnSin, b.turnCos)) - 2.5) < 1e-12).toBe(true);
		expect([b.bashRange, b.bashCooldownMin, b.bashCooldownMax, b.bashTelegraphTicks]).toEqual([1.8, 150, 210, 27]);
		expect([b.bashLineLength, b.bashLunge, b.bashLungeTicks, b.bashDamage, b.recoverTicks]).toEqual([
			1.6, 1.4, 9, 1, 36,
		]);
		expect(b.fx?.aimLine).toEqual({
			dirX: BULWARK_DIR_X,
			dirZ: BULWARK_DIR_Z,
			length: 1.6,
			boldTicks: 27,
			attack: 1,
		});
	});

	it("Chainhook: keep range, the throw, the hook (a HOOK bullet, 8 units), the drag, the yank (the imp's fan)", () => {
		const c = CHAINHOOK.data;
		expect([c.keepMin, c.keepMax, c.throwCooldownMin, c.throwCooldownMax, c.throwRange, c.aimTicks]).toEqual([
			4, 7, 240, 300, 8, 42,
		]);
		expect([c.hook.count, c.hook.spread, c.hook.speed, c.hook.life, c.hook.damage, c.hook.kind]).toEqual([
			1,
			0,
			16,
			0.5,
			0,
			BulletKind.HOOK,
		]);
		expect(c.hook.speed * c.hook.life).toBe(8);
		expect([c.pullSpeed, c.pullStop, c.dragMaxTicks, c.breakDamage]).toEqual([10, 1.3, 36, 3]);
		expect([c.yankTelegraphTicks, c.yankRingRadius]).toEqual([18, 1.6]);
		expect(c.yankFan).toBe(IMP.data.fan);
		expect([c.fx?.aimLine?.dirX, c.fx?.aimLine?.dirZ, c.fx?.aimLine?.length]).toEqual([
			CHAINHOOK_DIR_X,
			CHAINHOOK_DIR_Z,
			8,
		]);
	});

	it("Snatcher: eat reach, flee, stomach and swallow", () => {
		const s = SNATCHER.data;
		expect([s.eatRadius, s.fleeRadius, s.fleeRelease, s.fleeFactor]).toEqual([PELLET_PICKUP_RADIUS, 3, 4.5, 1.2]);
		expect([s.stomach, s.swallowAfterTicks, s.swallowTicks]).toEqual([5, 480, 60]);
	});

	it("Pyre-keeper and its brazier: caps, the cast, the landing points, the fire loop", () => {
		const k = PYREKEEPER.data;
		expect([k.keepMin, k.keepMax, k.pyreKind, k.maxAlive, k.perLife]).toEqual([6, 9, PYRE.id, 3, 6]);
		expect([k.lightCooldownMin, k.lightCooldownMax, k.lightTelegraphTicks, k.landingRingRadius]).toEqual([
			240, 300, 48, 0.8,
		]);
		expect([k.landingDistance, k.landingPlayerClear, k.landingPyreClear, k.panicRange]).toEqual([3.5, 2, 2, 2.5]);
		expect(k.landingOffsets.size()).toBe(8);
		for (const [x, z] of PYREKEEPER_LANDING_OFFSETS) expect(math.abs(x * x + z * z - 1) < 1e-15).toBe(true);
		expect([k.fx?.ring?.xSlot, k.fx?.ring?.zSlot]).toEqual([PYREKEEPER_LAND_X, PYREKEEPER_LAND_Z]);
		const p = PYRE.data;
		expect([p.litTicks, p.fireTicks, p.shotStaggerTicks]).toEqual([30, 120, 36]);
		expect([p.shot.count, p.shot.speed, p.shot.life, p.shot.damage, p.shot.kind]).toEqual([
			1,
			4.5,
			2.5,
			1,
			BulletKind.ENEMY,
		]);
	});

	it("encounter cost / kill points / drop chance rows (plan numbers); the brazier is never bought and never rolls", () => {
		const order = ["bulwark", "chainhook", "snatcher", "pyrekeeper"];
		expect(order.map(encounterCost)).toEqual([3, 3, 2, 3]);
		expect(order.map((id) => KILL_POINTS.get(id))).toEqual([200, 200, 150, 180]);
		expect(order.map((id) => DROPS.chanceByArchetype.get(id))).toEqual([8, 8, 15, 8]);
		expect([ENCOUNTER_COST.has(PYRE.id), KILL_POINTS.get(PYRE.id), DROPS.chanceByArchetype.has(PYRE.id)]).toEqual([
			false,
			30,
			false,
		]);
		expect(DROP_INELIGIBLE_ARCHETYPES.includes(PYRE.id)).toBe(true);
	});

	it("NX6 appends the four room enemies to the room pool, never the brazier (NXD5, NXD9, NXD4)", () => {
		const n = ENDLESS_ROOM_KINDS.size();
		const tail: unknown[][] = [];
		for (let i = n - 4; i < n; i++) {
			const k = ENDLESS_ROOM_KINDS[i];
			tail.push([k.kind, k.weight, k.maxPerRoom, k.needsCompany === true]);
		}
		expect(tail).toEqual([
			[BULWARK.id, 1, 2, false],
			[CHAINHOOK.id, 1, 1, false],
			[SNATCHER.id, 1, 1, true],
			[PYREKEEPER.id, 1, 1, false],
		]);
		for (const k of ENDLESS_ROOM_KINDS) expect([k.kind, k.kind === PYRE.id]).toEqual([k.kind, false]);
		expect([roomKindMinFloor(CHAINHOOK.id), roomKindMinFloor(BULWARK.id), roomKindMinFloor(PYREKEEPER.id)]).toEqual(
			[2, 1, 1],
		);
	});
});

describe("BulletKind.HOOK", () => {
	it("HOOK is 13, fits the payload and hits at the enemy bullet's radius (its rules: sim/chainhook.spec)", () => {
		expect(BulletKind.HOOK).toBe(13);
		expect(BulletKind.HOOK < BULLET_KIND_COUNT).toBe(true);
		expect(enemyBulletHitRadius(BulletKind.HOOK)).toBe(ENEMY_BULLET_RADIUS);
	});
});

describe("spawn and engage (NX1)", () => {
	function run(): SimState {
		const w = world();
		// Player at the origin; each room kind on its own spoke inside every aggro range, a brazier beside it.
		spawn(w, BULWARK.id, -6, 0);
		spawn(w, CHAINHOOK.id, 0, 6);
		spawn(w, SNATCHER.id, 0, -6);
		spawn(w, PYREKEEPER.id, 4, 4);
		spawn(w, PYRE.id, -4, -4);
		for (let t = 0; t < 120; t++) step(w.s, EMPTY_INPUT, w.config);
		return w.s;
	}

	it("the four engage and live; the brazier stands where it landed; the Bulwark guards", () => {
		const s = run();
		const by = (id: string) => s.combat.actors.find((a) => a.kind === archetypeIndex(id))!;
		for (const id of ROOM_IDS) expect([id, by(id).alive, by(id).v[0]]).toEqual([id, 1, 1]); // alive, engaged
		const pyre = by(PYRE.id);
		expect([pyre.alive, pyre.x, pyre.z]).toEqual([1, -4, -4]);
		expect(by(BULWARK.id).v[BULWARK_GUARDING]).toBe(1);
	});

	it("no kind draws but the Bulwark's and the Chainhook's first cooldowns (NX2 / NX3: in init; none runs out here)", () => {
		// The Pyre-keeper draws since NX5 (its first cooldown, strafe flips: sim/pyrekeeper.spec.ts); the brazier never.
		const w = world();
		spawn(w, BULWARK.id, -6, 0);
		spawn(w, CHAINHOOK.id, 0, 6);
		const before = w.s.rngState;
		spawn(w, SNATCHER.id, 0, -6);
		spawn(w, PYRE.id, -4, -4);
		for (let t = 0; t < 120; t++) step(w.s, EMPTY_INPUT, w.config);
		expect(w.s.rngState).toBe(before);
		expect(hashState(run())).toBe(hashState(run()));
	});

	it("keep-range stubs stay inside the band they walk to (the Bulwark closes to 2-3)", () => {
		const s = run();
		const b = s.combat.actors.find((a) => a.kind === archetypeIndex(BULWARK.id))!;
		const d = math.sqrt(b.x * b.x + b.z * b.z);
		expect(d >= BULWARK.data.keepMin - BULWARK.data.speed * SIM_DT).toBe(true);
		expect(d <= BULWARK.data.keepMax + BULWARK.data.speed * SIM_DT).toBe(true);
	});
});
