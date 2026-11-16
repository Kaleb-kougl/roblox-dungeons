// docs/NEW_ENEMIES_3.md NT1 skeleton: band 7 for the fourth set of room enemies (indices 24-26; every older index
// unchanged), their data blocks and rows (the plan's Design tables, with NT0 finding 12's keep range), the shrapnel's arc
// row (Ballista's 6 @ FULL_RING), the room pool untouched until NT6, and that every kind spawns, engages and replays
// bit for bit without a draw.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENCOUNTER_COST, ENDLESS_ROOM_KINDS, encounterCost } from "shared/dungeon";
import {
	BulletKind,
	DEFAULT_SIM_CONFIG,
	DROPS,
	DROP_INELIGIBLE_ARCHETYPES,
	EMPTY_INPUT,
	FULL_RING,
	HIT_NORMAL,
	JACKAL,
	JACKAL_DIR_X,
	JACKAL_DIR_Z,
	JACKAL_ATTACK_LUNGE,
	KILL_POINTS,
	MENDER,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	PORT_ARC_SOURCES,
	PORT_BAND_ENEMIES_3,
	PORT_BAND_ENEMIES_4,
	STRIKE_BULLET_RADIUS,
	SimCtx,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	hashState,
	spawnActor,
	step,
	type ActorState,
	type ArchetypeDef,
	type SimConfig,
	type SimState,
} from "shared/sim";

/** compareIds order. */
const NEW_IDS = ["jackal", "mender", "mortar"];
const FIRST = 24;
const DEFS: ReadonlyArray<ArchetypeDef> = [
	JACKAL as unknown as ArchetypeDef,
	MENDER as unknown as ArchetypeDef,
	MORTAR as unknown as ArchetypeDef,
];
/** ENDLESS_ROOM_KINDS order once NT6 appends them (the plan's Architecture 2). */
const ROOM_ORDER = ["mortar", "mender", "jackal"];

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

describe("registry: PORT_BAND_ENEMIES_4 (NTD1)", () => {
	it("is band 7; jackal, mender, mortar take indices 24-26", () => {
		expect([PORT_BAND_ENEMIES_3, PORT_BAND_ENEMIES_4]).toEqual([6, 7]);
		for (let k = 0; k < NEW_IDS.size(); k++) {
			const id = NEW_IDS[k];
			expect([id, archetypeIndex(id), archetypeAt(FIRST + k).band]).toEqual([id, FIRST + k, PORT_BAND_ENEMIES_4]);
			expect(DEFS[k].id).toBe(id);
		}
	});

	it("every older index is unchanged (0..23)", () => {
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
			"bulwark",
			"chainhook",
			"pyre",
			"pyrekeeper",
			"snatcher",
		]);
		expect(ids.size()).toBe(FIRST + NEW_IDS.size());
	});
});

describe("data blocks (the plan's Design tables)", () => {
	it("bodies: hp, radius, speed, contact damage, sprite id; all three are room enemies", () => {
		const bodies = DEFS.map((d) => [d.id, d.data.hp, d.data.radius, d.data.speed, d.data.contactDamage]);
		expect(bodies).toEqual([
			["jackal", 3, 0.32, 4.6, 0],
			["mender", 5, 0.35, 2.6, 0],
			["mortar", 4, 0.35, 2.2, 0],
		]);
		for (const d of DEFS) {
			expect([d.id, d.data.spriteId]).toEqual([d.id, `enemy.${d.id}`]);
			const room = (d.data as unknown as { roomEnemy?: boolean }).roomEnemy === true;
			expect([d.id, room, d.data.boss === true]).toEqual([d.id, true, false]);
		}
	});

	it("Mortar: keep 6-9 and lob within 10 (NT0 finding 12), draw, flight, lead, the shell (a STRIKE) and the shrapnel", () => {
		const m = MORTAR.data;
		expect([m.keepMin, m.keepMax, m.lobRange, m.tooClose, m.lostTicks]).toEqual([6, 9, 10, 3, 0]);
		expect([m.lobCooldownMin, m.lobCooldownMax, m.drawTicks, m.flightTicks, m.leadTicks, m.maxLead]).toEqual([
			192, 252, 21, 60, 36, 3,
		]);
		const sh = m.shell;
		expect([sh.count, sh.spread, sh.speed, sh.damage, sh.kind, sh.pierce, m.shellLifeTicks]).toEqual([
			1,
			0,
			0,
			HIT_NORMAL,
			BulletKind.STRIKE,
			6,
			6,
		]);
		const sp = m.shrapnel;
		expect([sp.count, sp.spread, sp.speed, sp.life, sp.damage, sp.kind]).toEqual([
			6,
			FULL_RING,
			3.5,
			1.2,
			HIT_NORMAL,
			BulletKind.ENEMY,
		]);
		expect(m.fx?.ring).toEqual({
			state: MORTAR_FLIGHT,
			xSlot: MORTAR_LAND_X,
			zSlot: MORTAR_LAND_Z,
			radius: STRIKE_BULLET_RADIUS,
			fillTicks: 60,
			attack: MORTAR_ATTACK_LOB,
		});
	});

	it("Mender: keep range, heal range and pick, link, channel, pulse, the body block, flinch, cooldowns, the bolt", () => {
		const d = MENDER.data;
		expect([d.keepMin, d.keepMax, d.healRange, d.pickEveryTicks, d.linkTicks, d.channelTicks]).toEqual([
			5, 8, 6, 15, 24, 180,
		]);
		expect([d.pulseTicks, d.healAmount, d.beamBlockPad, d.flinchTicks]).toEqual([30, 1, 0.15, 24]);
		expect([d.channelCooldownMin, d.channelCooldownMax, d.boltRange, d.boltCooldownMin, d.boltCooldownMax]).toEqual(
			[72, 96, 9, 132, 168],
		);
		const b = d.bolt;
		expect([b.count, b.spread, b.speed, b.life, b.damage, b.kind]).toEqual([
			1,
			0,
			4.5,
			2.5,
			HIT_NORMAL,
			BulletKind.CASTER,
		]);
	});

	it("Jackal: circling band, separation, the two cosines, wind-up, lunge, recover, spook, stagger, cooldowns, aim line", () => {
		const d = JACKAL.data;
		expect([d.circleMin, d.circleMax, d.separation, d.frontCos, d.spookCos]).toEqual([3, 3.6, 1.4, 0.34, 0.5]);
		expect([d.windupTicks, d.lungeDistance, d.lungeTicks, d.lungeDamage, d.recoverTicks]).toEqual([
			21,
			2.8,
			11,
			HIT_NORMAL,
			30,
		]);
		expect([d.hopDistance, d.hopTicks, d.spookCooldownTicks, d.staggerTicks]).toEqual([1.2, 12, 36, 60]);
		expect([d.lungeCooldownMin, d.lungeCooldownMax]).toEqual([84, 120]);
		expect(d.fx?.aimLine).toEqual({
			dirX: JACKAL_DIR_X,
			dirZ: JACKAL_DIR_Z,
			length: 2.8,
			boldTicks: 8,
			attack: JACKAL_ATTACK_LUNGE,
		});
	});

	it("encounter cost / kill points / drop chance rows (plan numbers): a Jackal costs 1 each", () => {
		expect(ROOM_ORDER.map(encounterCost)).toEqual([2, 2, 1]);
		for (const id of ROOM_ORDER) expect([id, ENCOUNTER_COST.has(id)]).toEqual([id, true]);
		expect(ROOM_ORDER.map((id) => KILL_POINTS.get(id))).toEqual([120, 150, 70]);
		expect(ROOM_ORDER.map((id) => DROPS.chanceByArchetype.get(id))).toEqual([8, 10, 4]);
		for (const id of ROOM_ORDER) expect([id, DROP_INELIGIBLE_ARCHETYPES.includes(id)]).toEqual([id, false]);
	});

	it("the shrapnel reads Ballista's port arc row (6 @ FULL_RING), which names the Mortar", () => {
		const row = PORT_ARC_SOURCES.filter((r) => r.count === 6 && r.spread === FULL_RING);
		expect(row.size()).toBe(1);
		expect(row[0].source.find("archetypes/mortar.ts shrapnel", 1, true)[0] !== undefined).toBe(true);
	});

	it("not in the room pool until NT6 (endless rooms spend exactly as before)", () => {
		for (const k of ENDLESS_ROOM_KINDS) expect([k.kind, ROOM_ORDER.includes(k.kind)]).toEqual([k.kind, false]);
	});
});

describe("spawn and engage (NT1 stubs)", () => {
	function run(): SimState {
		const w = world();
		// Player at the origin; each kind on its own spoke inside every aggro range.
		spawn(w, MORTAR.id, -6, 0);
		spawn(w, MENDER.id, 0, 6);
		spawn(w, JACKAL.id, 0, -5);
		spawn(w, JACKAL.id, 4, 4);
		for (let t = 0; t < 120; t++) step(w.s, EMPTY_INPUT, w.config);
		return w.s;
	}

	it("all engage and live; the stubs stand where they spawned facing the player (the Mortar is NT2's: mortar.spec)", () => {
		const s = run();
		let n = 0;
		const mortar = archetypeIndex(MORTAR.id);
		for (const a of s.combat.actors) {
			if (a.kind < FIRST) continue;
			n++;
			if (a.kind === mortar) {
				expect([a.alive, a.v[0]]).toEqual([1, 1]);
				continue;
			}
			expect([a.alive, a.v[0], a.x === a.v[1] && a.z === a.v[2]]).toEqual([1, 1, true]); // alive, engaged, home
			const len = math.sqrt(a.x * a.x + a.z * a.z);
			expect(math.abs(a.faceX + a.x / len) < 1e-9 && math.abs(a.faceZ + a.z / len) < 1e-9).toBe(true);
		}
		expect(n).toBe(4);
	});

	it("the stubs draw nothing yet (NT3-NT4; the Mortar's draws are mortar.spec's), and the run replays bit for bit", () => {
		const w = world();
		const before = w.s.rngState;
		spawn(w, MENDER.id, 0, 6);
		spawn(w, JACKAL.id, 0, -5);
		for (let t = 0; t < 120; t++) step(w.s, EMPTY_INPUT, w.config);
		expect(w.s.rngState).toBe(before);
		expect(hashState(run())).toBe(hashState(run()));
	});
});
