// docs/NEW_ENEMIES.md NE1 skeleton: band 4 for the second set of room enemies (indices 13-17; every older index
// unchanged), their data blocks and rows, BulletKind.STRIKE and its hit radius, the arc rows they will fire (none new),
// the Warbanner aura hook points (PERCENT today: actorWalkPercent / actorCooldownPercent are exactly the affix percent),
// and the stub steps (they engage and move, fire nothing and draw nothing).
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIX_RULES,
	ARC_SHAPES,
	BOMBER,
	BOMBER_BLAST_COUNT,
	BULLET_KIND_COUNT,
	BulletKind,
	CHARGER,
	DEFAULT_SIM_CONFIG,
	DROPS,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	FULL_RING,
	GOO_BULLET_RADIUS,
	KILL_POINTS,
	PERCENT,
	PORT_ARC_SHAPES,
	PORT_BAND_ENEMIES,
	PORT_BAND_ENEMIES_2,
	REAPER,
	REAPER_SPIRAL_COUNT,
	SIM_DT,
	STORMCALLER,
	STRIKE_BULLET_RADIUS,
	SWARMER,
	SimCtx,
	WARBANNER,
	actorCooldownPercent,
	actorWalkPercent,
	arcTrig,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	auraCooldownPercent,
	auraWalkPercent,
	createSimState,
	enemyBulletHitRadius,
	gen,
	hashState,
	scalePercent,
	spawnActor,
	step,
	walkStep,
	type ActorState,
	type ArchetypeDef,
	type SimConfig,
	type SimState,
} from "shared/sim";

const NEW_IDS = ["bomber", "charger", "reaper", "stormcaller", "warbanner"];
const DEFS: ReadonlyArray<ArchetypeDef> = [
	BOMBER as unknown as ArchetypeDef,
	CHARGER as unknown as ArchetypeDef,
	REAPER as unknown as ArchetypeDef,
	STORMCALLER as unknown as ArchetypeDef,
	WARBANNER as unknown as ArchetypeDef,
];

interface World {
	s: SimState;
	ctx: SimCtx;
	config: SimConfig;
}

function world(withAffixes = false): World {
	const config: SimConfig = { ...DEFAULT_SIM_CONFIG };
	if (withAffixes) config.affixes = AFFIXES_CONFIG;
	const s = createSimState(7, 0, 0, config);
	const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
	return { s, ctx, config };
}

function spawn(w: World, id: string, x: number, z: number, affix: number = AffixKind.NONE): ActorState {
	w.ctx.bind(w.s, w.config, EMPTY_INPUT);
	const a = spawnActor(w.ctx, archetypeIndex(id), x, z, affix);
	if (a === undefined) error("spawn failed", 0);
	return a;
}

describe("registry: PORT_BAND_ENEMIES_2 (NED1)", () => {
	it("is band 4; bomber, charger, reaper, stormcaller, warbanner take indices 13-17", () => {
		expect([PORT_BAND_ENEMIES, PORT_BAND_ENEMIES_2]).toEqual([3, 4]);
		for (let k = 0; k < NEW_IDS.size(); k++) {
			const id = NEW_IDS[k];
			expect([id, archetypeIndex(id), archetypeAt(13 + k).band]).toEqual([id, 13 + k, PORT_BAND_ENEMIES_2]);
			expect(DEFS[k].id).toBe(id);
			expect(DEFS[k].band).toBe(PORT_BAND_ENEMIES_2);
		}
	});

	it("every older index is unchanged (0..12)", () => {
		const ids = archetypeIds();
		const head: string[] = [];
		for (let i = 0; i < 13; i++) head.push(ids[i]);
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
		]);
		expect(ids.size()).toBe(18);
	});
});

describe("data blocks (the plan's Design tables)", () => {
	it("bodies: hp, radius, speed, contact damage, sprite id; every one a room enemy", () => {
		const bodies = DEFS.map((d) => [d.id, d.data.hp, d.data.radius, d.data.speed, d.data.contactDamage]);
		expect(bodies).toEqual([
			["bomber", 2, 0.3, 4, 0],
			["charger", 12, 0.5, 2.2, 0],
			["reaper", 7, 0.4, 3, 1],
			["stormcaller", 5, 0.35, 2.4, 0],
			["warbanner", 6, 0.35, 2.6, 0],
		]);
		for (const d of DEFS) {
			expect([d.id, d.data.spriteId]).toEqual([d.id, `enemy.${d.id}`]);
			expect([d.id, (d.data as unknown as { roomEnemy: boolean }).roomEnemy]).toEqual([d.id, true]);
		}
	});

	it("attack tunables in ticks and units", () => {
		const b = BOMBER.data;
		expect([b.fuseTrigger, b.fuseTicks, b.fuseRingRadius, b.blastBreakRadius]).toEqual([1.6, 42, 2, 1.5]);
		expect([b.blast.count, b.blast.spread, b.blast.radius]).toEqual([BOMBER_BLAST_COUNT, FULL_RING, 0.6]);
		const c = CHARGER.data;
		expect([c.keepMin, c.keepMax, c.chargeCooldownMin, c.chargeCooldownMax, c.laneTicks]).toEqual([
			5, 9, 180, 240, 45,
		]);
		expect([c.chargeSpeed, c.chargeRange, c.chargeDamage, c.stunTicks, c.recoverTicks]).toEqual([11, 9, 2, 84, 36]);
		const st = STORMCALLER.data;
		expect([st.keepMin, st.keepMax, st.castCooldownMin, st.castCooldownMax, st.castTicks]).toEqual([
			7, 10, 216, 264, 60,
		]);
		expect([st.strikeCount, st.strikeRadius, st.strikeSpacing, st.strikeLifeTicks]).toEqual([3, 1.1, 2.2, 6]);
		expect([st.strike.speed, st.strike.kind, st.strike.life]).toEqual([0, BulletKind.STRIKE, 6 * SIM_DT]);
		const w = WARBANNER.data;
		expect([w.keepMin, w.keepMax, w.auraRadius, w.auraWalkPercent, w.auraCooldownPercent]).toEqual([
			5, 8, 4.5, 125, 80,
		]);
		expect([w.panicRange, w.panicTelegraphTicks]).toEqual([2.5, 30]);
		const r = REAPER.data;
		expect([r.keepMin, r.keepMax, r.spinCooldownMin, r.spinCooldownMax, r.windTicks, r.windRingRadius]).toEqual([
			3, 4, 210, 270, 36, 3,
		]);
		expect([r.spinTicks, r.spinDriftSpeed, r.volleyEveryTicks, r.spiralShot.speed, r.spiralShot.life]).toEqual([
			96, 1.4, 8, 4, 1.6,
		]);
		// 12 volleys of 2 bullets (NED14)
		expect((r.spinTicks / r.volleyEveryTicks) * 2).toBe(24);
		expect(r.dizzyTicks).toBe(54);
	});

	it("encounter cost / kill points / drop chance rows (plan numbers)", () => {
		const order = ["bomber", "charger", "stormcaller", "warbanner", "reaper"];
		expect(order.map(encounterCost)).toEqual([2, 3, 3, 2, 3]);
		expect(order.map((id) => KILL_POINTS.get(id))).toEqual([80, 220, 180, 160, 200]);
		expect(order.map((id) => DROPS.chanceByArchetype.get(id))).toEqual([3, 10, 8, 10, 8]);
	});
});

describe("BulletKind.STRIKE and the arc rows", () => {
	it("STRIKE is 12, fits the payload, and hits at STRIKE_BULLET_RADIUS; every other kind's radius is unchanged", () => {
		expect(BulletKind.STRIKE).toBe(12);
		expect(BulletKind.STRIKE < BULLET_KIND_COUNT).toBe(true);
		expect(STRIKE_BULLET_RADIUS).toBe(1.1);
		expect(enemyBulletHitRadius(BulletKind.STRIKE)).toBe(STRIKE_BULLET_RADIUS);
		for (let k = 0; k < BULLET_KIND_COUNT; k++) {
			if (k === BulletKind.STRIKE) continue;
			expect([k, enemyBulletHitRadius(k)]).toEqual([
				k,
				k === BulletKind.GOO ? GOO_BULLET_RADIUS : ENEMY_BULLET_RADIUS,
			]);
		}
	});

	it("the Bomber's 12 @ FULL_RING is a port row; the Reaper's 16 @ FULL_RING is a web row (no new port row)", () => {
		const twelve = arcTrig(BOMBER_BLAST_COUNT, FULL_RING);
		expect(PORT_ARC_SHAPES.includes(twelve)).toBe(true);
		const sixteen = arcTrig(REAPER_SPIRAL_COUNT, FULL_RING);
		expect([sixteen.count, sixteen.full]).toEqual([16, true]);
		expect(ARC_SHAPES.includes(sixteen)).toBe(true);
		expect(PORT_ARC_SHAPES.includes(sixteen)).toBe(false);
		expect(gen.arc(BOMBER.data.blast.count, BOMBER.data.blast.spread, 2).size()).toBe(12);
		expect(gen.arc(REAPER.data.spiralCount, FULL_RING, 2).size()).toBe(16);
	});
});

describe("aura hook points (NE1: PERCENT, a pure refactor)", () => {
	it("aura percents are PERCENT for every actor, and the actor percents equal the affix percent exactly", () => {
		const w = world(true);
		const plain = spawn(w, SWARMER.id, 20, 0);
		const swift = spawn(w, SWARMER.id, -20, 0, AffixKind.SWIFT);
		const hulk = spawn(w, CHARGER.id, 0, 20, AffixKind.HULKING);
		const banner = spawn(w, WARBANNER.id, 0, -20);
		for (const a of [plain, swift, hulk, banner]) {
			expect([auraWalkPercent(w.ctx, a), auraCooldownPercent(w.ctx, a)]).toEqual([PERCENT, PERCENT]);
		}
		expect([actorWalkPercent(w.ctx, plain), actorCooldownPercent(w.ctx, plain)]).toEqual([PERCENT, PERCENT]);
		expect([actorWalkPercent(w.ctx, swift), actorCooldownPercent(w.ctx, swift)]).toEqual([
			AFFIX_RULES.swiftWalkPercent,
			AFFIX_RULES.swiftCooldownPercent,
		]);
		expect(actorWalkPercent(w.ctx, hulk)).toBe(AFFIX_RULES.hulkingWalkPercent);
		expect(walkStep(w.ctx, plain)).toBe(SWARMER.data.speed * SIM_DT);
		expect(walkStep(w.ctx, swift)).toBe(scalePercent(SWARMER.data.speed * SIM_DT, AFFIX_RULES.swiftWalkPercent));
	});

	it("without affixes every percent is PERCENT", () => {
		const w = world(false);
		for (const id of NEW_IDS) {
			const a = spawn(w, id, 10 + NEW_IDS.indexOf(id) * 3, 10);
			expect([id, actorWalkPercent(w.ctx, a), actorCooldownPercent(w.ctx, a)]).toEqual([id, PERCENT, PERCENT]);
			expect([id, walkStep(w.ctx, a)]).toEqual([id, archetypeAt(a.kind).data.speed * SIM_DT]);
		}
	});
});

describe("stub steps (NE1)", () => {
	function run(): SimState {
		const w = world(false);
		// Player at the origin; each new kind 6 units out on its own spoke, inside every aggro range.
		spawn(w, BOMBER.id, 6, 0);
		spawn(w, CHARGER.id, -6, 0);
		spawn(w, REAPER.id, 0, 6);
		spawn(w, STORMCALLER.id, 0, -6);
		spawn(w, WARBANNER.id, 4, 4);
		for (let t = 0; t < 120; t++) step(w.s, EMPTY_INPUT, w.config);
		return w.s;
	}

	it("they engage and move by their bands, fire nothing and draw nothing", () => {
		const w = world(false);
		const rng0 = w.s.rngState;
		const s = run();
		expect(s.rngState).toBe(rng0); // init + 120 steps: no draw on the main stream
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		const by = (id: string) => s.combat.actors.find((a) => a.kind === archetypeIndex(id))!;
		const dist = (a: ActorState) => math.sqrt(a.x * a.x + a.z * a.z);
		for (const id of NEW_IDS) expect([id, by(id).alive, by(id).v[0]]).toEqual([id, 1, 1]); // alive, engaged
		// Bomber chases in; Reaper closes to <= keepMax; Charger / Warbanner keep their minimum; Stormcaller backs off.
		expect(dist(by("bomber")) < 1).toBe(true);
		expect(dist(by("reaper")) <= REAPER.data.keepMax + 1e-9).toBe(true);
		expect(dist(by("charger"))).toBeCloseTo(6, 9);
		expect(dist(by("stormcaller")) >= STORMCALLER.data.keepMin - 1e-9).toBe(true);
		expect(dist(by("warbanner")) >= WARBANNER.data.keepMin - 1e-9).toBe(true);
	});

	it("replays bit for bit", () => {
		expect(hashState(run())).toBe(hashState(run()));
	});
});
